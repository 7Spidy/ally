import { describe, it, expect } from "vitest";
import {
  ACTIVE_FACT_CAP,
  dedupeFactIds,
  endedDay,
  expiredSummaries,
  overCapFactIds,
  parseDailyOut,
  planFactChanges,
  runDaily,
  runWeekly,
  shiftDay,
  weekKeyFor,
} from "@/lib/vault";
import type { ChatFn } from "@/lib/vault";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("dates", () => {
  it("weekKeyFor is the ISO week's Sunday", () => {
    expect(weekKeyFor("2026-05-11")).toBe("2026-05-17"); // Monday
    expect(weekKeyFor("2026-05-17")).toBe("2026-05-17"); // Sunday
    expect(weekKeyFor("2026-05-16")).toBe("2026-05-17");
    expect(weekKeyFor("2026-12-29")).toBe("2027-01-03");
  });
  it("endedDay is the IST day before now", () => {
    expect(endedDay(Date.UTC(2026, 4, 12, 19, 0))).toBe("2026-05-12"); // 00:30 IST on the 13th
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("parseDailyOut and planFactChanges", () => {
  it("parses, validates categories, clips facts", () => {
    const o = parseDailyOut(
      JSON.stringify({
        summary: "  She talked about work. ",
        add: [{ category: "work", fact: "x".repeat(400) }, { category: "bogus", fact: "no" }],
        update: [{ id: 1, fact: "new" }, { id: "z", fact: "bad" }],
        retire: [2, "x"],
        promises: ["Ira will send the book"],
      })
    );
    expect(o?.summary).toBe("She talked about work.");
    expect(o?.add).toHaveLength(1);
    expect(o?.add[0].fact.length).toBeLessThanOrEqual(280);
    expect(o?.update).toEqual([{ id: 1, fact: "new" }]);
    expect(o?.retire).toEqual([2]);
    expect(parseDailyOut("nope")).toBeNull();
  });
  it("only touches facts that exist, dedupes adds, files promises under promises", () => {
    const active = [{ id: 1, fact: "Works at a bank" }, { id: 2, fact: "Has a dog" }];
    const plan = planFactChanges(
      active,
      { summary: "", add: [{ category: "work", fact: "works at a BANK" }, { category: "people", fact: "Sister is Anu" }], update: [{ id: 1, fact: "Works at a bank in Pune" }, { id: 9, fact: "ghost" }], retire: [2, 8], promises: ["Send the book"] },
      "2026-05-12"
    );
    expect(plan.inserts).toEqual([
      { category: "people", fact: "Sister is Anu", source_day: "2026-05-12" },
      { category: "promises", fact: "Send the book", source_day: "2026-05-12" },
    ]);
    expect(plan.updates).toEqual([{ id: 1, fact: "Works at a bank in Pune" }]);
    expect(plan.retires).toEqual([2]);
  });
});

describe("fact housekeeping", () => {
  it("dedupes keeping the oldest", () => {
    expect(
      dedupeFactIds([
        { id: 2, fact: "Has a dog!", created_at: "2026-05-02" },
        { id: 1, fact: "has a dog", created_at: "2026-05-01" },
        { id: 3, fact: "Likes tea", created_at: "2026-05-03" },
      ])
    ).toEqual([2]);
  });
  it("caps active facts at 60, retiring the least recently used", () => {
    const facts = Array.from({ length: 65 }, (_, i) => ({
      id: i + 1,
      last_used_at: i < 5 ? null : `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      created_at: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const drop = overCapFactIds(facts);
    expect(drop).toHaveLength(65 - ACTIVE_FACT_CAP);
    expect(overCapFactIds(facts.slice(0, 60))).toEqual([]);
  });
  it("expires day summaries after 14 days and week summaries after 12 weeks", () => {
    const rows = [
      { id: 1, period: "day" as const, period_key: "2026-05-01" },
      { id: 2, period: "day" as const, period_key: "2026-05-10" },
      { id: 3, period: "week" as const, period_key: "2026-02-01" },
      { id: 4, period: "week" as const, period_key: "2026-04-05" },
    ];
    expect(expiredSummaries(rows, "2026-05-16")).toEqual([1, 3]);
  });
});

// ---------------------------------------------------------------------------
// Jobs, against an in-memory fake of the few supabase calls they make.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const writes: { table: string; op: string }[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    let payload: Row | Row[] | null = null;
    let ignoreDup = false;
    const q: Record<string, unknown> = {};
    const getPath = (r: Row, col: string) => (col.includes("->>") ? String(((r[col.split("->>")[0]] as Row) ?? {})[col.split("->>")[1]]) : r[col]);
    const run = () => {
      const rows = (tables[table] ??= []);
      if (mode === "select") return { data: rows.filter((r) => filters.every((f) => f(r))), error: null };
      writes.push({ table, op: mode });
      if (mode === "insert") {
        for (const p of [payload].flat() as Row[]) rows.push({ id: rows.length + 1000, active: true, ...p });
      } else if (mode === "upsert") {
        const p = payload as Row;
        const dup = rows.some((r) => r.companion_id === p.companion_id && r.period === p.period && r.period_key === p.period_key);
        if (!dup) rows.push({ id: rows.length + 1000, ...p });
        else if (!ignoreDup) Object.assign(rows.find((r) => r.companion_id === p.companion_id && r.period_key === p.period_key)!, p);
      } else if (mode === "update") {
        for (const r of rows.filter((r) => filters.every((f) => f(r)))) Object.assign(r, payload);
      } else if (mode === "delete") {
        tables[table] = rows.filter((r) => !filters.every((f) => f(r)));
      }
      return { data: null, error: null };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain = q as Record<string, (...a: any[]) => unknown>;
    chain.select = () => q;
    chain.insert = (p: unknown) => ((mode = "insert"), (payload = p as Row), q);
    chain.update = (p: unknown) => ((mode = "update"), (payload = p as Row), q);
    chain.delete = () => ((mode = "delete"), q);
    chain.upsert = (p: unknown, o?: { ignoreDuplicates?: boolean }) => ((mode = "upsert"), (payload = p as Row), (ignoreDup = !!o?.ignoreDuplicates), q);
    chain.eq = (c: unknown, v: unknown) => (filters.push((r) => getPath(r, c as string) === v), q);
    chain.neq = (c: unknown, v: unknown) => (filters.push((r) => r[c as string] !== v), q);
    chain.in = (c: unknown, v: unknown) => (filters.push((r) => (v as unknown[]).includes(r[c as string])), q);
    chain.gte = (c: unknown, v: unknown) => (filters.push((r) => String(r[c as string]) >= String(v)), q);
    chain.lte = (c: unknown, v: unknown) => (filters.push((r) => String(r[c as string]) <= String(v)), q);
    chain.lt = (c: unknown, v: unknown) => (filters.push((r) => String(r[c as string]) < String(v)), q);
    chain.order = () => q;
    chain.then = (res: (v: unknown) => unknown) => res(run());
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, writes, tables };
}

const NOW = Date.UTC(2026, 4, 12, 19, 0); // 00:30 IST 13 May; the ended day is 2026-05-12
const DAY_START = "2026-05-12T05:00:00.000Z";

const chatFn: ChatFn = async () => ({
  content: JSON.stringify({ summary: "A day.", add: [{ category: "work", fact: "Has a manager" }], update: [], retire: [], promises: [] }),
  model: "m",
  usage: { input: 0, output: 0, cached: 0 },
  latencyMs: 1,
});

function seed() {
  return {
    companions: [
      { id: "c1", user_id: "u1", status: "active", template_id: "F01", core: { primary: "ROMANTIC" } },
      { id: "c2", user_id: "u2", status: "active", template_id: "F01", core: { primary: "ROMANTIC" } },
      { id: "c3", user_id: "u3", status: "active", template_id: "M16", core: { primary: "PSYCH" } },
    ],
    messages: [
      { id: 1, companion_id: "c1", who: "me", text: "hello", created_at: DAY_START, meta: {} },
      { id: 2, companion_id: "c1", who: "them", text: "hi", created_at: DAY_START, meta: {} },
      { id: 3, companion_id: "c2", who: "me", text: "private crisis", created_at: DAY_START, meta: { safety: true } },
      { id: 4, companion_id: "c3", who: "me", text: "not live", created_at: DAY_START, meta: {} },
    ] as Row[],
    memory_summaries: [] as Row[],
    memory_facts: [] as Row[],
  };
}

describe("runDaily", () => {
  it("summarises live companions with messages that day, and is idempotent", async () => {
    const t = seed();
    const { db, tables } = fakeDb(t as unknown as Record<string, Row[]>);
    const first = await runDaily(db, chatFn, NOW);
    expect(first).toEqual({ processed: 2, remaining: 0 });
    const days = tables.memory_summaries.filter((r) => r.period === "day");
    expect(days.map((r) => r.companion_id).sort()).toEqual(["c1", "c2"]);
    expect(days.find((r) => r.companion_id === "c1")?.summary).toBe("A day.");
    expect(tables.memory_facts).toHaveLength(1);
    const again = await runDaily(db, chatFn, NOW);
    expect(again).toEqual({ processed: 0, remaining: 0 });
    expect(tables.memory_summaries).toHaveLength(2);
  });

  it("ignores messages marked safety: the model is never called for them", async () => {
    const t = seed();
    const { db, tables } = fakeDb(t as unknown as Record<string, Row[]>);
    const seen: string[] = [];
    await runDaily(db, async (a) => {
      seen.push(a.messages[0].content);
      return chatFn(a);
    }, NOW);
    expect(seen.join("")).not.toContain("private crisis");
    expect(tables.memory_summaries.find((r) => r.companion_id === "c2")?.summary).toBe("");
  });

  it("processes at most the batch size and reports the rest", async () => {
    const t = seed();
    const { db } = fakeDb(t as unknown as Record<string, Row[]>);
    expect(await runDaily(db, chatFn, NOW, 1)).toEqual({ processed: 1, remaining: 1 });
  });

  it("leaves a companion queued when the model fails", async () => {
    const t = seed();
    const { db, tables } = fakeDb(t as unknown as Record<string, Row[]>);
    const r = await runDaily(db, async () => Promise.reject(new Error("down")), NOW);
    expect(r.processed).toBe(1); // c2 had nothing usable, so it is marked done
    expect(r.remaining).toBe(1);
    expect(tables.memory_summaries.find((x) => x.companion_id === "c1")).toBeUndefined();
  });

  it("never writes to messages", async () => {
    const t = seed();
    const { db, writes } = fakeDb(t as unknown as Record<string, Row[]>);
    await runDaily(db, chatFn, NOW);
    expect(writes.filter((w) => w.table === "messages")).toEqual([]);
  });
});

describe("runWeekly", () => {
  const weekNow = Date.UTC(2026, 4, 17, 20, 50); // Monday 02:20 IST; the ended day is Sunday 2026-05-17
  function weekly() {
    const t = seed();
    t.memory_summaries = [
      { id: 1, companion_id: "c1", user_id: "u1", period: "day", period_key: "2026-05-12", summary: "Tuesday." },
      { id: 2, companion_id: "c1", user_id: "u1", period: "day", period_key: "2026-05-15", summary: "Friday." },
      { id: 3, companion_id: "c1", user_id: "u1", period: "day", period_key: "2026-04-20", summary: "Old day." },
    ];
    t.memory_facts = [
      { id: 1, companion_id: "c1", fact: "Has a dog", active: true, last_used_at: null, created_at: "2026-05-01" },
      { id: 2, companion_id: "c1", fact: "has a dog.", active: true, last_used_at: null, created_at: "2026-05-02" },
    ];
    return t;
  }
  const weekChat: ChatFn = async () => ({ content: JSON.stringify({ summary: "A week." }), model: "m", usage: { input: 0, output: 0, cached: 0 }, latencyMs: 1 });

  it("compacts the week, prunes old day summaries, dedupes facts, and never touches messages", async () => {
    const t = weekly();
    const { db, tables, writes } = fakeDb(t as unknown as Record<string, Row[]>);
    const r = await runWeekly(db, weekChat, weekNow);
    expect(r).toEqual({ processed: 1, remaining: 0 });
    const wk = tables.memory_summaries.find((x) => x.period === "week");
    expect(wk).toMatchObject({ companion_id: "c1", period_key: "2026-05-17", summary: "A week." });
    expect(tables.memory_summaries.some((x) => x.period_key === "2026-04-20")).toBe(false);
    expect(tables.memory_facts.find((f) => f.id === 2)?.active).toBe(false);
    expect(tables.memory_facts.find((f) => f.id === 1)?.active).toBe(true);
    expect(writes.filter((w) => w.table === "messages")).toEqual([]);
    expect(tables.messages).toHaveLength(4);
  });

  it("is idempotent", async () => {
    const t = weekly();
    const { db, tables } = fakeDb(t as unknown as Record<string, Row[]>);
    await runWeekly(db, weekChat, weekNow);
    const count = tables.memory_summaries.length;
    expect(await runWeekly(db, weekChat, weekNow)).toEqual({ processed: 0, remaining: 0 });
    expect(tables.memory_summaries).toHaveLength(count);
  });
});
