import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { isLive } from "@/lib/live";
import { dayKey } from "@/lib/clock";
import * as heart from "@/lib/heart";
import { compile } from "@/lib/llm/compile";
import { bubbleMeta, grantLevelUpPetals, LIVE_OUT_SCHEMA, parseLiveOut, sanitize, type Effect, type LiveOut, type MsgMeta } from "@/lib/llm/contract";
import { chat } from "@/lib/llm/xai";
import { applySafety } from "@/lib/safety";
import { applyReply, freshDay, relationshipDay, wordCount, type TrustDay, type TrustState } from "@/lib/trust";
import type { CoreId } from "@/state/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface CompanionRow {
  id: string;
  user_id: string;
  template_id: string;
  core: { primary: CoreId | null };
  answers: { q10?: string | null };
  created_at: string;
  status: string;
  trust_level: number;
  highest_level: number;
  trust_points: number;
  level_changed_at: string | null;
  last_drop_at: string | null;
  below_since: string | null;
  signal_since_level: boolean;
  cool_off_until: string | null;
  safety_until: string | null;
  trust_frozen_until: string | null;
  paused_reason: string | null;
  last_replied_msg: number;
}

interface MsgRow {
  id: number;
  who: "them" | "me";
  text: string;
  created_at: string;
  meta: MsgMeta | null;
  in_reply_to: number | null;
}

const ms = (s: string | null) => (s ? Date.parse(s) : null);
const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

function bubblesOf(rows: MsgRow[]) {
  return rows.map((m) => ({ id: m.id, text: m.text, meta: m.meta ?? {}, at: Date.parse(m.created_at) }));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { companionId?: unknown; mode?: unknown } | null;
  const companionId = typeof body?.companionId === "string" ? body.companionId : "";
  const mode = body?.mode === "opener" ? "opener" : body?.mode === "reply" ? "reply" : null;
  if (!companionId || !mode) return json({ error: "bad_request" }, 400);

  const supabase = await getServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  // RLS proves ownership.
  const { data: own } = await supabase.from("companions").select("*").eq("id", companionId).maybeSingle();
  const c = own as CompanionRow | null;
  if (!c || c.status !== "active") return json({ error: "not_found" }, 404);
  if (!isLive({ templateId: c.template_id, core: c.core })) return json({ error: "not_live" }, 409);
  if (c.paused_reason) return json({ error: "paused" }, 423);

  const db = getAdminClient();
  const now = Date.now();
  const prevReplied = c.last_replied_msg;

  // Idempotency lock (spec 4.3 step 2).
  let userMsg: MsgRow | null = null;
  if (mode === "reply") {
    const { data } = await db.from("messages").select("id,who,text,created_at,meta,in_reply_to").eq("companion_id", c.id).eq("who", "me").order("id", { ascending: false }).limit(1);
    userMsg = ((data ?? []) as MsgRow[])[0] ?? null;
    if (!userMsg) return json({ error: "no_message" }, 409);
    const { data: claimed } = await db.from("companions").update({ last_replied_msg: userMsg.id }).eq("id", c.id).lt("last_replied_msg", userMsg.id).select("id");
    if (!claimed?.length) {
      const { data: existing } = await db.from("messages").select("id,who,text,created_at,meta,in_reply_to").eq("companion_id", c.id).eq("in_reply_to", userMsg.id).order("id");
      if (existing?.length) return json({ replayed: true, reaction: null, bubbles: bubblesOf(existing as MsgRow[]), trustLevel: c.trust_level, leveledUp: null, resourceCard: false, paused: false });
      return json({ pending: true }, 202);
    }
  } else {
    const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("companion_id", c.id);
    if ((count ?? 0) > 0) return json({ error: "not_empty" }, 409);
    const { data: claimed } = await db.from("companions").update({ last_replied_msg: -1 }).eq("id", c.id).eq("last_replied_msg", 0).select("id");
    if (!claimed?.length) return json({ pending: true }, 202);
  }
  const release = () => db.from("companions").update({ last_replied_msg: prevReplied }).eq("id", c.id);

  try {
    // Context
    const { data: histDesc } = await db.from("messages").select("id,who,text,created_at,meta,in_reply_to").eq("companion_id", c.id).order("id", { ascending: false }).limit(30);
    const history = ((histDesc ?? []) as MsgRow[]).reverse();
    const messageAt = userMsg ? Date.parse(userMsg.created_at) : now;
    const today = dayKey(messageAt);
    const todayStart = new Date(`${today}T00:00:00+05:30`).toISOString();

    const [{ data: factRows }, { data: dayRows }, { data: weekRows }, { data: profile }, { data: tdRow }, { data: todayThem }, { data: pins }] = await Promise.all([
      db.from("memory_facts").select("id,category,fact").eq("companion_id", c.id).eq("active", true).order("last_used_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(40),
      db.from("memory_summaries").select("period_key,summary").eq("companion_id", c.id).eq("period", "day").neq("summary", "").order("period_key", { ascending: false }).limit(7),
      db.from("memory_summaries").select("period_key,summary").eq("companion_id", c.id).eq("period", "week").neq("summary", "").order("period_key", { ascending: false }).limit(4),
      db.from("profiles").select("display_name").eq("id", c.user_id).maybeSingle(),
      db.from("trust_days").select("msg_points,session_bonus,disclosure_bonus,user_msgs").eq("companion_id", c.id).eq("day", today).maybeSingle(),
      db.from("messages").select("meta").eq("companion_id", c.id).eq("who", "them").gte("created_at", todayStart),
      db.from("messages").select("id").eq("companion_id", c.id).eq("who", "them").eq("meta->>effect", "pin").gte("created_at", new Date(now - 30 * 86400000).toISOString()).limit(1),
    ]);

    const level = c.trust_level;
    const createdAt = Date.parse(c.created_at);
    const relDay = relationshipDay(createdAt, messageAt);
    const h = heart.now({ id: c.id, createdAt }, messageAt);
    const lastMe = history.filter((m) => m.who === "me");
    const milestone = heart.milestoneFor({
      ist: h.ist,
      createdDayKey: dayKey(createdAt),
      relationshipDay: relDay,
      rainMentioned: heart.mentionsRain(lastMe.slice(-10).map((m) => m.text)),
      leveledUp: null,
    });
    const coolOff = (ms(c.cool_off_until) ?? 0) > now;
    const safetyMode = (ms(c.safety_until) ?? 0) > now;
    const lowEffort = lastMe.length >= 5 && lastMe.slice(-5).every((m) => wordCount(m.text) <= 1);

    const compiled = compile({
      level,
      mode,
      userName: profile?.display_name ?? "",
      heart: h,
      milestone,
      facts: (factRows ?? []) as { id: number; category: string; fact: string }[],
      weekSummaries: ((weekRows ?? []) as { period_key: string; summary: string }[]).map((r) => ({ key: r.period_key, summary: r.summary })),
      daySummaries: ((dayRows ?? []) as { period_key: string; summary: string }[]).map((r) => ({ key: r.period_key, summary: r.summary })),
      history: history.map((m) => ({ id: m.id, who: m.who, text: m.text })),
      coolOff,
      safetyMode,
      lowEffort,
      pressure: c.answers?.q10 ?? null,
    });

    // One model call; one retry when the reply is not the JSON object (edge case 3).
    let out: LiveOut | null = null;
    for (let attempt = 0; attempt < 2 && !out; attempt++) {
      const res = await chat({
        system: attempt === 0 ? compiled.system : `${compiled.system}\n\nReturn only the JSON object.`,
        messages: compiled.messages,
        schema: LIVE_OUT_SCHEMA,
        schemaName: "ira_reply",
        maxTokens: 500,
        temperature: 0.9,
        companionId: c.id,
      });
      out = parseLiveOut(res.content);
    }
    if (!out) throw new Error("unparseable");

    // Gates
    const effectsToday: Partial<Record<Effect, number>> = {};
    let screensToday = 0;
    for (const r of (todayThem ?? []) as { meta: MsgMeta | null }[]) {
      if (r.meta?.effect) effectsToday[r.meta.effect] = (effectsToday[r.meta.effect] ?? 0) + 1;
      if (r.meta?.screen) screensToday++;
    }
    const userMsgIds = lastMe.map((m) => m.id);
    const clean = sanitize(out, {
      level,
      latestMeId: userMsg?.id ?? -1,
      quotableIds: userMsgIds,
      recentUserReactions: lastMe.slice().reverse().slice(0, 5).map((m) => !!m.meta?.reaction),
      effectsToday,
      screensToday,
      pinInLast30d: (pins ?? []).length > 0,
      milestone,
      quiet: coolOff || safetyMode,
    });

    const userText = userMsg?.text ?? "";
    const safe = mode === "reply" ? applySafety(clean, { userText, now }) : { out: clean, band: "none" as const, events: [], resourceCard: false, paused: false, safetyMeta: false, safetyUntil: null, trustFrozenUntil: null };

    // Trust (skipped for the opener). An acute band freezes trust before it runs.
    let trust: TrustState = {
      level: c.trust_level,
      highestLevel: c.highest_level,
      points: c.trust_points,
      levelChangedAt: ms(c.level_changed_at),
      lastDropAt: ms(c.last_drop_at),
      belowSince: c.below_since,
      signalSinceLevel: c.signal_since_level,
      coolOffUntil: ms(c.cool_off_until),
      trustFrozenUntil: safe.trustFrozenUntil ?? ms(c.trust_frozen_until),
    };
    const dayBefore: TrustDay = tdRow
      ? { msgPoints: tdRow.msg_points, sessionBonus: tdRow.session_bonus, disclosureBonus: tdRow.disclosure_bonus, userMsgs: tdRow.user_msgs }
      : freshDay();
    let day: TrustDay | null = null;
    let leveledUp: number | null = null;
    if (mode === "reply" && userMsg) {
      const newUserMsgs = Math.max(1, history.filter((m) => m.who === "me" && m.id > prevReplied).length);
      const r = applyReply(trust, dayBefore, {
        messageAt,
        words: wordCount(userText),
        userMsgs: newUserMsgs,
        disclosure: out.disclosure,
        mutualVulnerability: out.mutualVulnerability,
        abusive: out.abusive,
        relationshipDay: relDay,
      }, now);
      trust = r.state;
      day = r.day;
      leveledUp = r.leveledUp;
    }

    const finalOut = grantLevelUpPetals(safe.out, { level: trust.level, leveledUp, screensToday, band: safe.band });
    const bubbles = finalOut.bubbles.map((b, i) => ({ text: b.text, meta: bubbleMeta(finalOut, i, safe.safetyMeta) }));

    const { data: written, error } = await db.rpc("write_live_reply", {
      p: {
        companionId: c.id,
        userMessageId: userMsg?.id ?? null,
        reaction: finalOut.reaction,
        userSafety: safe.safetyMeta,
        bubbles,
        trust: mode === "reply" ? trust : null,
        day: day ? { key: today, ...day } : null,
        safetyUntilMs: safe.safetyUntil,
        pausedReason: safe.paused ? "age_check" : null,
        events: safe.events,
      },
    });
    if (error) throw error;
    const result = written as { discarded: boolean; bubbles: { id: number; text: string; meta: MsgMeta; at: number }[] };
    if (result.discarded) return json({ error: "not_found" }, 404);

    // last_used_at for the facts the model just read (best effort).
    const usedIds = ((factRows ?? []) as { id: number }[]).map((f) => f.id);
    if (usedIds.length) await db.from("memory_facts").update({ last_used_at: new Date(now).toISOString() }).in("id", usedIds);

    return json({
      reaction: finalOut.reaction,
      screen: finalOut.screen,
      bubbles: result.bubbles,
      trustLevel: trust.level,
      leveledUp,
      resourceCard: safe.resourceCard,
      paused: safe.paused,
    });
  } catch {
    await release();
    return json({ error: "reply_failed" }, 502);
  }
}
