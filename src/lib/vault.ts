/**
 * B2 memory vault (spec 4.9). Daily and weekly jobs that compact what the
 * model reads: day summaries, week summaries and a fact list. Messages are
 * never deleted or changed by anything in this file (D9); this module only
 * SELECTs from `messages`. Every insert is idempotent through the
 * unique (companion_id, period, period_key) constraint.
 *
 * The pure helpers are unit-tested; runDaily/runWeekly take a service-role
 * client and a chat function, so tests can pass fakes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { dayKey } from "@/lib/clock";
import { istDaysBetween } from "@/lib/trust";
import type { ChatArgs, ChatResult } from "@/lib/llm/xai";

export const CATEGORIES = ["people", "work", "schedule", "dates", "tastes", "jokes", "promises", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const BATCH = 25;
export const ACTIVE_FACT_CAP = 60;
export const DAY_SUMMARY_KEEP_DAYS = 14;
export const WEEK_SUMMARY_KEEP_WEEKS = 12;
export const FACT_MAX_CHARS = 280;
export const DAY_SUMMARY_MAX_CHARS = 1600;

export interface Fact {
  id: number;
  category: string;
  fact: string;
  active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface DailyOut {
  summary: string;
  add: { category: Category; fact: string }[];
  update: { id: number; fact: string }[];
  retire: number[];
  promises: string[];
}

export type ChatFn = (args: ChatArgs) => Promise<ChatResult>;

const DAY_MS = 86400000;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export const DAILY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "add", "update", "retire", "promises"],
  properties: {
    summary: { type: "string" },
    add: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "fact"],
        properties: { category: { type: "string", enum: [...CATEGORIES] }, fact: { type: "string" } },
      },
    },
    update: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "fact"], properties: { id: { type: "integer" }, fact: { type: "string" } } },
    },
    retire: { type: "array", items: { type: "integer" } },
    promises: { type: "array", items: { type: "string" } },
  },
} as const;

export const WEEKLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: { summary: { type: "string" } },
} as const;

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…";
}

export function parseDailyOut(text: string): DailyOut | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof o.summary !== "string") return null;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    summary: clip(o.summary, DAY_SUMMARY_MAX_CHARS),
    add: arr(o.add)
      .filter((a): a is { category: Category; fact: string } => !!a && typeof a.fact === "string" && CATEGORIES.includes(a.category))
      .map((a) => ({ category: a.category, fact: clip(a.fact, FACT_MAX_CHARS) }))
      .filter((a) => a.fact),
    update: arr(o.update)
      .filter((u): u is { id: number; fact: string } => !!u && Number.isInteger(u.id) && typeof u.fact === "string")
      .map((u) => ({ id: u.id, fact: clip(u.fact, FACT_MAX_CHARS) })),
    retire: arr(o.retire).filter((n): n is number => Number.isInteger(n)),
    promises: arr(o.promises)
      .filter((p): p is string => typeof p === "string")
      .map((p) => clip(p, FACT_MAX_CHARS))
      .filter(Boolean),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** What the daily model output changes, restricted to facts that exist and are active. */
export function planFactChanges(active: Pick<Fact, "id" | "fact">[], out: DailyOut, sourceDay: string) {
  const ids = new Set(active.map((f) => f.id));
  const existing = new Set(active.map((f) => norm(f.fact)));
  const inserts: { category: string; fact: string; source_day: string }[] = [];
  for (const a of out.add) {
    if (!existing.has(norm(a.fact))) {
      existing.add(norm(a.fact));
      inserts.push({ category: a.category, fact: a.fact, source_day: sourceDay });
    }
  }
  for (const p of out.promises) {
    if (!existing.has(norm(p))) {
      existing.add(norm(p));
      inserts.push({ category: "promises", fact: p, source_day: sourceDay });
    }
  }
  return {
    inserts,
    updates: out.update.filter((u) => ids.has(u.id)),
    retires: out.retire.filter((id) => ids.has(id)),
  };
}

/** Ids to retire so that no two active facts say the same thing (the oldest is kept). */
export function dedupeFactIds(facts: Pick<Fact, "id" | "fact" | "created_at">[]): number[] {
  const seen = new Set<string>();
  const drop: number[] = [];
  for (const f of [...facts].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)) {
    const k = norm(f.fact);
    if (seen.has(k)) drop.push(f.id);
    else seen.add(k);
  }
  return drop;
}

/** Ids to retire so at most `cap` stay active: least recently used first, never-used oldest. */
export function overCapFactIds(facts: Pick<Fact, "id" | "last_used_at" | "created_at">[], cap = ACTIVE_FACT_CAP): number[] {
  if (facts.length <= cap) return [];
  const stamp = (f: Pick<Fact, "last_used_at" | "created_at">) => f.last_used_at ?? f.created_at;
  const sorted = [...facts].sort((a, b) => stamp(a).localeCompare(stamp(b)) || a.id - b.id);
  return sorted.slice(0, facts.length - cap).map((f) => f.id);
}

/** The Sunday that ends the ISO week containing `key` (YYYY-MM-DD). */
export function weekKeyFor(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  const add = dow === 0 ? 0 : 7 - dow;
  return shiftDay(key, add);
}

export function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Summaries the weekly job deletes. */
export function expiredSummaries(
  rows: { id: number; period: "day" | "week"; period_key: string }[],
  today: string
): number[] {
  return rows
    .filter((r) => (r.period === "day" ? istDaysBetween(r.period_key, today) > DAY_SUMMARY_KEEP_DAYS : istDaysBetween(r.period_key, today) > WEEK_SUMMARY_KEEP_WEEKS * 7))
    .map((r) => r.id);
}

function dailyPrompt(day: string, msgs: { who: string; text: string }[], facts: Pick<Fact, "id" | "category" | "fact">[]): ChatArgs {
  const system = [
    "You keep the memory notes for Ira, a companion in a chat app. Read one day of conversation and return JSON only.",
    "summary: at most 120 words, third person, what happened and what mattered.",
    "add: new lasting facts about the user, each { category, fact } with category one of " + CATEGORIES.join(", ") + ". One short sentence each.",
    "update: { id, fact } to correct an existing fact. retire: ids of facts now false or stale.",
    "promises: open promises either side made, as short sentences.",
    "Never record health crises, self-harm, or anything about the user's age. Do not invent.",
  ].join("\n");
  const known = facts.length ? facts.map((f) => `#${f.id} [${f.category}] ${f.fact}`).join("\n") : "(none)";
  const convo = msgs.map((m) => `${m.who === "me" ? "User" : "Ira"}: ${m.text}`).join("\n");
  return { system, messages: [{ role: "user", content: `Day: ${day}\n\nKnown facts:\n${known}\n\nConversation:\n${convo}` }], schema: DAILY_SCHEMA, schemaName: "daily_memory", maxTokens: 700, temperature: 0.2 };
}

function weeklyPrompt(weekKey: string, days: { period_key: string; summary: string }[]): ChatArgs {
  const system = "Compact one week of day summaries about a user's chats with Ira into one week summary, at most 200 words, third person. Return JSON only.";
  const body = days.map((d) => `${d.period_key}: ${d.summary}`).join("\n");
  return { system, messages: [{ role: "user", content: `Week ending ${weekKey}\n\n${body}` }], schema: WEEKLY_SCHEMA, schemaName: "weekly_memory", maxTokens: 500, temperature: 0.2 };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface RunResult {
  processed: number;
  remaining: number;
}

interface LiveRow {
  id: string;
  user_id: string;
}

async function liveCompanions(db: SupabaseClient): Promise<LiveRow[]> {
  const { data, error } = await db
    .from("companions")
    .select("id,user_id")
    .eq("status", "active")
    .eq("template_id", "F01")
    .eq("core->>primary", "ROMANTIC");
  if (error) throw error;
  return (data ?? []) as LiveRow[];
}

/** The IST day that just ended, relative to `now`. */
export function endedDay(now: number): string {
  return dayKey(now - DAY_MS);
}

function istDayRange(key: string): { from: string; to: string } {
  return { from: new Date(`${key}T00:00:00+05:30`).toISOString(), to: new Date(`${shiftDay(key, 1)}T00:00:00+05:30`).toISOString() };
}

export async function runDaily(db: SupabaseClient, chat: ChatFn, now: number, batch = BATCH): Promise<RunResult> {
  const day = endedDay(now);
  const { from, to } = istDayRange(day);
  const live = await liveCompanions(db);
  if (!live.length) return { processed: 0, remaining: 0 };
  const liveIds = live.map((c) => c.id);

  const { data: msgIds } = await db.from("messages").select("companion_id").in("companion_id", liveIds).gte("created_at", from).lt("created_at", to);
  const active = new Set((msgIds ?? []).map((r: { companion_id: string }) => r.companion_id));
  const { data: done } = await db.from("memory_summaries").select("companion_id").eq("period", "day").eq("period_key", day).in("companion_id", liveIds);
  const doneSet = new Set((done ?? []).map((r: { companion_id: string }) => r.companion_id));
  const todo = live.filter((c) => active.has(c.id) && !doneSet.has(c.id));

  let processed = 0;
  for (const c of todo.slice(0, batch)) {
    const { data: msgs } = await db.from("messages").select("who,text,meta").eq("companion_id", c.id).gte("created_at", from).lt("created_at", to).order("id");
    const usable = ((msgs ?? []) as { who: string; text: string; meta: { safety?: boolean } | null }[]).filter((m) => !m.meta?.safety);
    const { data: factRows } = await db.from("memory_facts").select("id,category,fact,active,last_used_at,created_at").eq("companion_id", c.id).eq("active", true);
    const facts = (factRows ?? []) as Fact[];

    let summary = "";
    if (usable.length) {
      let out: DailyOut | null = null;
      try {
        const res = await chat(dailyPrompt(day, usable, facts));
        out = parseDailyOut(res.content);
      } catch {
        out = null;
      }
      if (!out) continue; // leave it queued for the next slot
      summary = out.summary;
      const plan = planFactChanges(facts, out, day);
      if (plan.inserts.length) await db.from("memory_facts").insert(plan.inserts.map((f) => ({ ...f, companion_id: c.id, user_id: c.user_id })));
      for (const u of plan.updates) await db.from("memory_facts").update({ fact: u.fact }).eq("id", u.id).eq("companion_id", c.id);
      if (plan.retires.length) await db.from("memory_facts").update({ active: false }).in("id", plan.retires).eq("companion_id", c.id);
    }
    // An empty summary marks a day with nothing usable (for example only safety messages) as done.
    await db.from("memory_summaries").upsert({ companion_id: c.id, user_id: c.user_id, period: "day", period_key: day, summary }, { onConflict: "companion_id,period,period_key", ignoreDuplicates: true });
    processed++;
  }
  return { processed, remaining: Math.max(0, todo.length - processed) };
}

export async function runWeekly(db: SupabaseClient, chat: ChatFn, now: number, batch = BATCH): Promise<RunResult> {
  const today = dayKey(now);
  const weekKey = weekKeyFor(endedDay(now));
  const weekStart = shiftDay(weekKey, -6);
  const live = await liveCompanions(db);
  if (!live.length) return { processed: 0, remaining: 0 };
  const liveIds = live.map((c) => c.id);

  const { data: days } = await db.from("memory_summaries").select("companion_id,period_key,summary").in("companion_id", liveIds).eq("period", "day").gte("period_key", weekStart).lte("period_key", weekKey);
  const { data: weeks } = await db.from("memory_summaries").select("companion_id").in("companion_id", liveIds).eq("period", "week").eq("period_key", weekKey);
  const haveWeek = new Set((weeks ?? []).map((r: { companion_id: string }) => r.companion_id));
  const byCompanion = new Map<string, { period_key: string; summary: string }[]>();
  for (const r of (days ?? []) as { companion_id: string; period_key: string; summary: string }[]) {
    byCompanion.set(r.companion_id, [...(byCompanion.get(r.companion_id) ?? []), r]);
  }
  const todo = live.filter((c) => byCompanion.has(c.id) && !haveWeek.has(c.id));

  let processed = 0;
  for (const c of todo.slice(0, batch)) {
    const rows = (byCompanion.get(c.id) ?? []).filter((d) => d.summary.trim()).sort((a, b) => a.period_key.localeCompare(b.period_key));
    if (rows.length) {
      let text: string | null = null;
      try {
        const res = await chat(weeklyPrompt(weekKey, rows));
        const o = JSON.parse(res.content.slice(res.content.indexOf("{"), res.content.lastIndexOf("}") + 1)) as { summary?: unknown };
        if (typeof o.summary === "string") text = clip(o.summary, DAY_SUMMARY_MAX_CHARS);
      } catch {
        text = null;
      }
      if (text === null) continue;
      await db.from("memory_summaries").upsert({ companion_id: c.id, user_id: c.user_id, period: "week", period_key: weekKey, summary: text }, { onConflict: "companion_id,period,period_key", ignoreDuplicates: true });
    } else {
      await db.from("memory_summaries").upsert({ companion_id: c.id, user_id: c.user_id, period: "week", period_key: weekKey, summary: "" }, { onConflict: "companion_id,period,period_key", ignoreDuplicates: true });
    }

    const { data: all } = await db.from("memory_summaries").select("id,period,period_key").eq("companion_id", c.id);
    const expired = expiredSummaries((all ?? []) as { id: number; period: "day" | "week"; period_key: string }[], today);
    if (expired.length) await db.from("memory_summaries").delete().in("id", expired);

    const { data: fr } = await db.from("memory_facts").select("id,fact,last_used_at,created_at").eq("companion_id", c.id).eq("active", true);
    const facts = (fr ?? []) as Fact[];
    const dupes = dedupeFactIds(facts);
    const left = facts.filter((f) => !dupes.includes(f.id));
    const retire = [...dupes, ...overCapFactIds(left)];
    if (retire.length) await db.from("memory_facts").update({ active: false }).in("id", retire).eq("companion_id", c.id);
    processed++;
  }
  return { processed, remaining: Math.max(0, todo.length - processed) };
}
