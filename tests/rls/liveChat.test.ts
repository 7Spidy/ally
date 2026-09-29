import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { PASS_CAP } from "@/lib/config";

// B2 live chat (supabase/migrations/20261001000001_live_chat.sql), against the
// local Supabase stack (`npm run db:start`, `npm run e2e:env`).
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
const SECRET = process.env.SUPABASE_SECRET_KEY as string;
const CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(URL, SECRET, noPersist);
const createdIds: string[] = [];

interface TestUser {
  id: string;
  client: SupabaseClient;
}

async function makeUser(label: string, role?: "admin"): Promise<TestUser> {
  const email = `rlsb2+${label}-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  createdIds.push(data.user.id);
  if (role) await service.from("profiles").update({ role }).eq("id", data.user.id);
  const client = createClient(URL, PUBLISHABLE, noPersist);
  const signIn = await client.auth.signInWithPassword({ email, password, options: { captchaToken: CAPTCHA } });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

const ANSWERS = { q5: 0, q6: 0, q7: 0, q8: 0, q9: 0, q10: "head", q11: [] };
const ROMANTIC = { primary: "ROMANTIC", secondary: null, weight: 100, ranked: [{ id: "ROMANTIC", score: 9 }] };
const PSYCH = { primary: "PSYCH", secondary: null, weight: 100, ranked: [{ id: "PSYCH", score: 9 }] };

async function rpc<T = Record<string, unknown>>(u: TestUser, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await u.client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
}

async function create(u: TestUser, templateId: string, core: object): Promise<{ id: string }> {
  return rpc(u, "create_companion", { template_id: templateId, deck_gender: templateId.startsWith("F") ? "woman" : "man", answers: ANSWERS, core, display_name: "" });
}

let a: TestUser;
let b: TestUser;
let adm: TestUser;
let live: { id: string };
let mocked: { id: string };
let bLive: { id: string };

beforeAll(async () => {
  a = await makeUser("a");
  b = await makeUser("b");
  adm = await makeUser("adm", "admin");
  live = await create(a, "F01", ROMANTIC);
  await rpc(a, "unlock_slot", { amount: 199 });
  mocked = await create(a, "M01", PSYCH);
  bLive = await create(b, "F01", ROMANTIC);
});

afterAll(async () => {
  for (const id of createdIds) await service.auth.admin.deleteUser(id);
});

async function writeReply(p: Record<string, unknown>) {
  const { data, error } = await service.rpc("write_live_reply", { p });
  if (error) throw new Error(`write_live_reply: ${error.message}`);
  return data as { discarded: boolean; bubbles: { id: number; text: string; meta: Record<string, unknown> }[] };
}

describe("D5: clients cannot write Ira's messages", () => {
  it("receive_reply and seed_opener raise live_companion for a live companion", async () => {
    for (const [fn, args] of [
      ["receive_reply", { companion_id: live.id, body: "hi" }],
      ["seed_opener", { companion_id: live.id, body: "hi" }],
    ] as const) {
      const { error } = await a.client.rpc(fn, args);
      expect(error?.message, fn).toContain("live_companion");
      expect(error?.code).toBe("22023");
    }
  });
  it("a mocked companion keeps both", async () => {
    const opener = await rpc<{ message: { text: string } | null }>(a, "seed_opener", { companion_id: mocked.id, body: "hey" });
    expect(opener.message?.text).toBe("hey");
    const reply = await rpc<{ message: { text: string } }>(a, "receive_reply", { companion_id: mocked.id, body: "hello" });
    expect(reply.message.text).toBe("hello");
  });
  it("a non-ROMANTIC F01 is not live", async () => {
    const u = await makeUser("nonlive");
    const c = await create(u, "F01", PSYCH);
    const r = await rpc<{ message: { text: string } | null }>(u, "seed_opener", { companion_id: c.id, body: "ok" });
    expect(r.message?.text).toBe("ok");
  });
  it("clients cannot insert messages directly", async () => {
    const { error } = await a.client.from("messages").insert({ companion_id: live.id, user_id: a.id, who: "them", text: "forged" });
    expect(error).not.toBeNull();
  });
});

describe("memory tables", () => {
  beforeAll(async () => {
    await service.from("memory_facts").insert([
      { companion_id: live.id, user_id: a.id, category: "work", fact: "Has a manager", source_day: "2026-05-12" },
      { companion_id: bLive.id, user_id: b.id, category: "work", fact: "B's fact", source_day: "2026-05-12" },
    ]);
    await service.from("memory_summaries").insert([
      { companion_id: live.id, user_id: a.id, period: "day", period_key: "2026-05-12", summary: "A's day" },
      { companion_id: bLive.id, user_id: b.id, period: "day", period_key: "2026-05-12", summary: "B's day" },
    ]);
  });

  it("users read only their own facts and summaries", async () => {
    const facts = await a.client.from("memory_facts").select("fact");
    expect(facts.data?.map((r) => r.fact)).toEqual(["Has a manager"]);
    const sums = await a.client.from("memory_summaries").select("summary");
    expect(sums.data?.map((r) => r.summary)).toEqual(["A's day"]);
  });

  it("users cannot write them", async () => {
    const ins = await a.client.from("memory_facts").insert({ companion_id: live.id, user_id: a.id, category: "work", fact: "x", source_day: "2026-05-12" });
    expect(ins.error).not.toBeNull();
    const upd = await a.client.from("memory_facts").update({ fact: "changed" }).eq("companion_id", live.id).select();
    expect(upd.data ?? []).toEqual([]);
    const del = await a.client.from("memory_summaries").delete().eq("companion_id", live.id).select();
    expect(del.data ?? []).toEqual([]);
    const still = await service.from("memory_summaries").select("summary").eq("companion_id", live.id);
    expect(still.data).toHaveLength(1);
  });

  it("the summary and fact lengths are checked", async () => {
    const { error } = await service.from("memory_facts").insert({ companion_id: live.id, user_id: a.id, category: "work", fact: "x".repeat(281), source_day: "2026-05-12" });
    expect(error).not.toBeNull();
    const { error: e2 } = await service.from("memory_summaries").insert({ companion_id: live.id, user_id: a.id, period: "day", period_key: "2026-05-13", summary: "y".repeat(1601) });
    expect(e2).not.toBeNull();
  });

  it("a summary is unique per companion, period and key", async () => {
    const { error } = await service.from("memory_summaries").insert({ companion_id: live.id, user_id: a.id, period: "day", period_key: "2026-05-12", summary: "dup" });
    expect(error).not.toBeNull();
  });
});

describe("trust_days and safety_events", () => {
  beforeAll(async () => {
    await service.from("trust_days").insert({ companion_id: live.id, user_id: a.id, day: "2026-05-12", msg_points: 3, user_msgs: 4 });
    await service.from("safety_events").insert({ user_id: a.id, companion_id: live.id, kind: "concern" });
  });

  it("have no client access", async () => {
    const t = await a.client.from("trust_days").select("*");
    expect(t.data ?? []).toEqual([]);
    const s = await a.client.from("safety_events").select("*");
    expect(s.data ?? []).toEqual([]);
    const ins = await a.client.from("safety_events").insert({ user_id: a.id, kind: "acute" });
    expect(ins.error).not.toBeNull();
    const ins2 = await a.client.from("trust_days").insert({ companion_id: live.id, user_id: a.id, day: "2026-05-13" });
    expect(ins2.error).not.toBeNull();
  });

  it("admins can read them", async () => {
    const t = await adm.client.from("trust_days").select("*").eq("companion_id", live.id);
    expect(t.data).toHaveLength(1);
    const s = await adm.client.from("safety_events").select("kind").eq("user_id", a.id);
    expect(s.data?.map((r) => r.kind)).toContain("concern");
  });

  it("safety_events has no text column", async () => {
    const { data } = await service.from("safety_events").select("*").eq("user_id", a.id).limit(1);
    expect(Object.keys(data![0]).sort()).toEqual(["companion_id", "created_at", "id", "kind", "user_id"]);
  });

  it("admin_get_user reports trust and 30-day safety counts", async () => {
    const { data, error } = await adm.client.rpc("admin_get_user", { target: a.id });
    expect(error).toBeNull();
    const d = data as { safety_counts: Record<string, number>; companions: { id: string; live: boolean; trust_level: number; relationship_day: number }[] };
    expect(d.safety_counts.concern).toBe(1);
    const c = d.companions.find((x) => x.id === live.id)!;
    expect(c).toMatchObject({ live: true, trust_level: 1, relationship_day: 0 });
  });
});

describe("get_my_state", () => {
  it("never exposes trust_points or thresholds, and carries the new fields", async () => {
    await service.from("companions").update({ trust_points: 77 }).eq("id", live.id);
    const state = await rpc<{ companions: Record<string, unknown>[]; messages_by_companion: Record<string, Record<string, unknown>[]>; consent: unknown }>(a, "get_my_state");
    const c = state.companions.find((x) => x.id === live.id)!;
    expect(JSON.stringify(state)).not.toMatch(/trust_points|trustPoints|highest_level|below_since|cool_off|trust_frozen/);
    expect(c).toMatchObject({ trustLevel: 1, pausedReason: null, lastCtxDay: null, levelChangedAt: null });
    const msgs = state.messages_by_companion[mocked.id];
    expect(msgs[0]).toHaveProperty("id");
    expect(msgs[0]).toHaveProperty("meta");
    expect(msgs[0]).toHaveProperty("inReplyTo");
  });
});

describe("write_live_reply", () => {
  it("is service-role only", async () => {
    const { error } = await a.client.rpc("write_live_reply", { p: {} });
    expect(error).not.toBeNull();
  });

  it("writes reaction, bubbles, trust and events in one go", async () => {
    const sent = await rpc<{ message: { id: number } }>(a, "send_message", { companion_id: live.id, body: "my manager moved the deadline again" });
    const r = await writeReply({
      companionId: live.id,
      userMessageId: sent.message.id,
      reaction: "👀",
      userSafety: true,
      bubbles: [{ text: "again.", meta: { effect: "soft", quoteId: 1 } }, { text: "ok", meta: {} }],
      trust: { level: 2, highestLevel: 2, points: 41, levelChangedAt: Date.now(), lastDropAt: null, belowSince: null, signalSinceLevel: false, coolOffUntil: null, trustFrozenUntil: null },
      day: { key: "2026-05-12", msgPoints: 1, sessionBonus: false, disclosureBonus: false, userMsgs: 1 },
      safetyUntilMs: Date.now() + 3600000,
      pausedReason: null,
      events: ["concern"],
    });
    expect(r.discarded).toBe(false);
    expect(r.bubbles).toHaveLength(2);
    const { data: msgs } = await service.from("messages").select("id,who,text,meta,in_reply_to").eq("companion_id", live.id).order("id");
    const user = msgs!.find((m) => m.id === sent.message.id)!;
    expect(user.meta).toMatchObject({ reaction: "👀", safety: true });
    const bubbles = msgs!.filter((m) => m.who === "them");
    expect(bubbles.map((m) => m.in_reply_to)).toEqual([sent.message.id, sent.message.id]);
    expect(bubbles[0].meta).toEqual({ effect: "soft", quoteId: 1 });
    const { data: c } = await service.from("companions").select("*").eq("id", live.id).single();
    expect(c).toMatchObject({ trust_level: 2, highest_level: 2, trust_points: 41, unread: 2 });
    expect(c!.safety_until).not.toBeNull();
    const { data: td } = await service.from("trust_days").select("*").eq("companion_id", live.id).eq("day", "2026-05-12").single();
    expect(td).toMatchObject({ msg_points: 1, user_msgs: 1 });
  });

  it("discards the reply when the companion has parted", async () => {
    const u = await makeUser("parted");
    const c = await create(u, "F01", ROMANTIC);
    await rpc(u, "part_companion", { companion_id: c.id });
    const r = await writeReply({ companionId: c.id, userMessageId: null, reaction: null, userSafety: false, bubbles: [{ text: "late", meta: {} }], trust: null, day: null, events: [] });
    expect(r.discarded).toBe(true);
    const { data } = await service.from("messages").select("id").eq("companion_id", c.id);
    expect(data).toEqual([]);
  });

  it("pauses a chat for an age check, and clear_age_check needs an adult date of birth", async () => {
    const u = await makeUser("age");
    const c = await create(u, "F01", ROMANTIC);
    await writeReply({ companionId: c.id, userMessageId: null, reaction: null, userSafety: false, bubbles: [{ text: "hold on", meta: {} }], trust: null, day: null, pausedReason: "age_check", events: ["age_claim"] });
    const state = await rpc<{ companions: { id: string; pausedReason: string | null }[] }>(u, "get_my_state");
    expect(state.companions[0].pausedReason).toBe("age_check");

    const year = new Date().getFullYear();
    const minor = await u.client.rpc("clear_age_check", { companion_id: c.id, dob: `${year - 16}-01-01` });
    expect(minor.error?.message).toContain("under_18");
    const future = await u.client.rpc("clear_age_check", { companion_id: c.id, dob: `${year + 1}-01-01` });
    expect(future.error?.message).toContain("invalid_dob");
    await rpc(u, "clear_age_check", { companion_id: c.id, dob: `${year - 30}-01-01` });
    const after = await rpc<{ companions: { pausedReason: string | null }[] }>(u, "get_my_state");
    expect(after.companions[0].pausedReason).toBeNull();
  });

  it("clear_age_check is refused for someone else's companion", async () => {
    const { error } = await b.client.rpc("clear_age_check", { companion_id: live.id, dob: "1990-01-01" });
    expect(error?.code).toBe("P0002");
  });
});

describe("mark_ctx_shown", () => {
  it("sets last_ctx_day to today's IST key", async () => {
    await rpc(a, "mark_ctx_shown", { companion_id: live.id });
    const { data } = await service.from("companions").select("last_ctx_day").eq("id", live.id).single();
    const { data: key } = await service.rpc("ist_day_key", { ts: new Date().toISOString() });
    expect(data!.last_ctx_day).toBe(key);
  });
});

describe("trust decay (ally_private.trust_decay)", () => {
  it("costs idle companions 5 TP and starts the below-threshold clock", async () => {
    const u = await makeUser("decay");
    const c = await create(u, "F01", ROMANTIC);
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    await service.from("companions").update({ trust_level: 2, trust_points: 41, created_at: old }).eq("id", c.id);
    const { error } = await service.rpc("run_trust_decay");
    expect(error).toBeNull();
    const { data } = await service.from("companions").select("trust_points,trust_level,below_since").eq("id", c.id).single();
    expect(data).toMatchObject({ trust_points: 36, trust_level: 2 });
    expect(data!.below_since).not.toBeNull();
  });

  it("demotes one level after 7 days below, once", async () => {
    const u = await makeUser("demote");
    const c = await create(u, "F01", ROMANTIC);
    const old = new Date(Date.now() - 20 * 86400000).toISOString();
    const eight = new Date(Date.now() - 8 * 86400000).toISOString();
    const { data: key } = await service.rpc("ist_day_key", { ts: eight });
    await service.from("companions").update({ trust_level: 3, trust_points: 100, created_at: old, below_since: key as string }).eq("id", c.id);
    await service.rpc("run_trust_decay");
    const { data } = await service.from("companions").select("trust_level,last_drop_at,below_since").eq("id", c.id).single();
    expect(data!.trust_level).toBe(2);
    expect(data!.last_drop_at).not.toBeNull();
    expect(data!.below_since).toBeNull();
    // a second pass inside 7 days does not drop again
    await service.from("companions").update({ below_since: key as string }).eq("id", c.id);
    await service.rpc("run_trust_decay");
    const again = await service.from("companions").select("trust_level").eq("id", c.id).single();
    expect(again.data!.trust_level).toBe(2);
  });

  it("run_trust_decay is service-role only: permission denied for authenticated and anon", async () => {
    const authed = await a.client.rpc("run_trust_decay");
    expect(authed.error?.code).toBe("42501");
    expect(authed.error?.message).toMatch(/permission denied/i);
    const anon = await createClient(URL, PUBLISHABLE, noPersist).rpc("run_trust_decay");
    expect(anon.error?.code).toBe("42501");
    expect(anon.error?.message).toMatch(/permission denied/i);
  });

  it("write_live_reply is service-role only: permission denied for authenticated and anon", async () => {
    const authed = await a.client.rpc("write_live_reply", { p: {} });
    expect(authed.error?.code).toBe("42501");
    const anon = await createClient(URL, PUBLISHABLE, noPersist).rpc("write_live_reply", { p: {} });
    expect(anon.error?.code).toBe("42501");
  });
});

describe("D12: the day-pass cap is 200", () => {
  it("caps a pass at 200 sends", async () => {
    expect(PASS_CAP).toBe(200);
    const u = await makeUser("cap");
    const c = await create(u, "M01", PSYCH);
    await rpc(u, "buy_pass");
    await service.from("ledgers").update({ pass_used: 199 }).eq("user_id", u.id);
    const ok = await rpc<{ blocked: boolean }>(u, "send_message", { companion_id: c.id, body: "one" });
    expect(ok.blocked).toBe(false);
    const capped = await rpc<{ blocked: boolean; status: string }>(u, "send_message", { companion_id: c.id, body: "two" });
    expect(capped).toMatchObject({ blocked: true, status: "capped" });
  });
});
