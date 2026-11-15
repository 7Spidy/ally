import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// U1 UX fixes (supabase/migrations/20261115000001_ux_fixes.sql), against the
// local Supabase stack (`npm run db:start`, `npm run e2e:env`).
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
const SECRET = process.env.SUPABASE_SECRET_KEY as string;
const CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(URL, SECRET, noPersist);
const anon = createClient(URL, PUBLISHABLE, noPersist);
const createdIds: string[] = [];

interface TestUser {
  id: string;
  client: SupabaseClient;
}

async function makeUser(label: string): Promise<TestUser> {
  const email = `ux+${label}-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  createdIds.push(data.user.id);
  const client = createClient(URL, PUBLISHABLE, noPersist);
  const signIn = await client.auth.signInWithPassword({ email, password, options: { captchaToken: CAPTCHA } });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

async function rpc<T = Record<string, unknown>>(u: TestUser, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await u.client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
}

/** The rpc's error message, or null if it succeeded. */
async function rpcError(client: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<string | null> {
  const { error } = await client.rpc(fn, args);
  return error ? error.message : null;
}

const ANSWERS = { q5: 0.4, q6: 0.5, q7: 0.5, q8: 0.38, q9: 0.5, q10: "head", q11: ["music"] };
const CORE = { primary: "ROMANTIC", secondary: null, weight: 100, ranked: [{ id: "ROMANTIC", score: 0.9 }] };
const create = (u: TestUser, t: string) =>
  rpc<{ id: string }>(u, "create_companion", { template_id: t, deck_gender: t.startsWith("F") ? "woman" : "man", answers: ANSWERS, core: CORE, display_name: "" });

interface Msg {
  id: number;
  who: string;
  text: string;
  meta: Record<string, unknown>;
  inReplyTo: number | null;
  editedAt: number | null;
  deleted: boolean;
}

interface MyState {
  messages_by_companion: Record<string, Msg[]>;
  has_more_by_companion: Record<string, boolean>;
}

/** Inserts `n` alternating messages (me first) in one statement and returns their ids, oldest first. */
async function seed(userId: string, companionId: string, n: number): Promise<number[]> {
  const rows = Array.from({ length: n }, (_, i) => ({ companion_id: companionId, user_id: userId, who: i % 2 === 0 ? "me" : "them", text: `msg ${i}` }));
  const { data, error } = await service.from("messages").insert(rows).select("id").order("id");
  if (error) throw error;
  return (data ?? []).map((r) => r.id as number);
}

async function insertRow(userId: string, companionId: string, row: Record<string, unknown>): Promise<number> {
  const { data, error } = await service.from("messages").insert({ companion_id: companionId, user_id: userId, ...row }).select("id").single();
  if (error) throw error;
  return data.id as number;
}

async function companionRow(id: string) {
  const { data, error } = await service.from("companions").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

async function ledgerRow(uid: string) {
  const { data } = await service.from("ledgers").select("free_used").eq("user_id", uid).maybeSingle();
  return (data?.free_used as number | undefined) ?? 0;
}

let a: TestUser;
let b: TestUser;
let ac: { id: string };
let bc: { id: string };

beforeAll(async () => {
  expect(URL, "run `npm run e2e:env` first").toBeTruthy();
  a = await makeUser("a");
  b = await makeUser("b");
  ac = await create(a, "F01");
  bc = await create(b, "F02");
});

afterAll(async () => {
  for (const id of createdIds) await service.auth.admin.deleteUser(id);
});

describe("get_my_state paging", () => {
  it("returns the newest 50 per companion, oldest to newest, with has_more true", async () => {
    const ids = await seed(a.id, ac.id, 120);
    const s = await rpc<MyState>(a, "get_my_state");
    const list = s.messages_by_companion[ac.id];
    expect(list).toHaveLength(50);
    expect(list.map((m) => m.id)).toEqual(ids.slice(-50));
    expect(list.map((m) => m.id)).toEqual([...list.map((m) => m.id)].sort((x, y) => x - y));
    expect(s.has_more_by_companion[ac.id]).toBe(true);
  });

  it("has_more is false at exactly 50 and below, and a chat with no messages has no entry", async () => {
    const u = await makeUser("few");
    const c = await create(u, "F03");
    let s = await rpc<MyState>(u, "get_my_state");
    expect(s.messages_by_companion[c.id]).toBeUndefined();
    expect(s.has_more_by_companion[c.id]).toBeUndefined();
    await seed(u.id, c.id, 50);
    s = await rpc<MyState>(u, "get_my_state");
    expect(s.messages_by_companion[c.id]).toHaveLength(50);
    expect(s.has_more_by_companion[c.id]).toBe(false);
    await seed(u.id, c.id, 1);
    s = await rpc<MyState>(u, "get_my_state");
    expect(s.messages_by_companion[c.id]).toHaveLength(50);
    expect(s.has_more_by_companion[c.id]).toBe(true);
  });

  it("pages each companion on its own", async () => {
    const u = await makeUser("two");
    await service.rpc("set_subscription", { p_user_id: u.id, p_plan: "ultra", p_status: "active", p_expires_at: new Date(Date.now() + 86400000).toISOString(), p_purchase_token: `tok-${randomUUID()}`, p_product_id: "ally_ultra" });
    const c1 = await create(u, "F04");
    const c2 = await create(u, "F05");
    await seed(u.id, c1.id, 70);
    await seed(u.id, c2.id, 20);
    const s = await rpc<MyState>(u, "get_my_state");
    expect(s.messages_by_companion[c1.id]).toHaveLength(50);
    expect(s.messages_by_companion[c2.id]).toHaveLength(20);
    expect(s.has_more_by_companion[c1.id]).toBe(true);
    expect(s.has_more_by_companion[c2.id]).toBe(false);
  });

  it("is unchanged for everything else in the payload", async () => {
    const s = await rpc<Record<string, unknown>>(a, "get_my_state");
    for (const k of ["server_now", "companions", "messages_by_companion", "ledger", "entitlement", "profile", "consent"]) expect(s).toHaveProperty(k);
  });
});

describe("get_messages_before", () => {
  it("returns the page before an id, oldest to newest, and says whether more remain", async () => {
    const s = await rpc<MyState>(a, "get_my_state");
    const loaded = s.messages_by_companion[ac.id];
    const r1 = await rpc<{ messages: Msg[]; hasMore: boolean }>(a, "get_messages_before", { companion_id: ac.id, before_id: loaded[0].id });
    expect(r1.messages).toHaveLength(50);
    expect(r1.messages[r1.messages.length - 1].id).toBeLessThan(loaded[0].id);
    expect(r1.messages.map((m) => m.id)).toEqual([...r1.messages.map((m) => m.id)].sort((x, y) => x - y));
    expect(r1.hasMore).toBe(true);
    const r2 = await rpc<{ messages: Msg[]; hasMore: boolean }>(a, "get_messages_before", { companion_id: ac.id, before_id: r1.messages[0].id });
    expect(r2.messages).toHaveLength(20);
    expect(r2.hasMore).toBe(false);
    const seen = new Set([...loaded, ...r1.messages, ...r2.messages].map((m) => m.id));
    expect(seen.size).toBe(120);
  });

  it("clamps limit_n to 1..100", async () => {
    const s = await rpc<MyState>(a, "get_my_state");
    const before = s.messages_by_companion[ac.id][49].id + 1;
    const big = await rpc<{ messages: Msg[] }>(a, "get_messages_before", { companion_id: ac.id, before_id: before, limit_n: 500 });
    expect(big.messages).toHaveLength(100);
    const zero = await rpc<{ messages: Msg[] }>(a, "get_messages_before", { companion_id: ac.id, before_id: before, limit_n: 0 });
    expect(zero.messages).toHaveLength(1);
    const neg = await rpc<{ messages: Msg[] }>(a, "get_messages_before", { companion_id: ac.id, before_id: before, limit_n: -5 });
    expect(neg.messages).toHaveLength(1);
  });

  it("another user gets an error, and so does anon", async () => {
    expect(await rpcError(b.client, "get_messages_before", { companion_id: ac.id, before_id: 999999999 })).toMatch(/companion_not_found/);
    expect(await rpcError(anon, "get_messages_before", { companion_id: ac.id, before_id: 999999999 })).not.toBeNull();
  });

  it("still pages a locked companion and an expired plan (reading is never gated)", async () => {
    const u = await makeUser("expired-read");
    const c = await create(u, "F06");
    const ids = await seed(u.id, c.id, 10);
    await service.from("profiles").update({ trial_started_at: new Date(Date.now() - 30 * 86400000).toISOString() }).eq("id", u.id);
    const r = await rpc<{ messages: Msg[]; hasMore: boolean }>(u, "get_messages_before", { companion_id: c.id, before_id: ids[9] });
    expect(r.messages).toHaveLength(9);
  });
});

describe("get_pinned_messages", () => {
  it("lists her non-deleted pins newest first and nothing else", async () => {
    const u = await makeUser("pins");
    const c = await create(u, "F07");
    const p1 = await insertRow(u.id, c.id, { who: "them", text: "first pin", meta: { effect: "pin" } });
    await insertRow(u.id, c.id, { who: "them", text: "plain", meta: {} });
    await insertRow(u.id, c.id, { who: "them", text: "loud", meta: { effect: "loud" } });
    await insertRow(u.id, c.id, { who: "me", text: "my own pin-shaped row", meta: { effect: "pin" } });
    const gone = await insertRow(u.id, c.id, { who: "them", text: "gone pin", meta: { effect: "pin" } });
    await service.from("messages").update({ text: "", deleted_at: new Date().toISOString() }).eq("id", gone);
    const p2 = await insertRow(u.id, c.id, { who: "them", text: "second pin", meta: { effect: "pin" } });
    const pins = await rpc<Msg[]>(u, "get_pinned_messages", { companion_id: c.id });
    expect(pins.map((m) => m.id)).toEqual([p2, p1]);
    expect(pins.map((m) => m.text)).toEqual(["second pin", "first pin"]);
  });

  it("caps at 50", async () => {
    const u = await makeUser("pins50");
    const c = await create(u, "F08");
    await service.from("messages").insert(Array.from({ length: 60 }, (_, i) => ({ companion_id: c.id, user_id: u.id, who: "them", text: `pin ${i}`, meta: { effect: "pin" } })));
    const pins = await rpc<Msg[]>(u, "get_pinned_messages", { companion_id: c.id });
    expect(pins).toHaveLength(50);
    expect(pins[0].text).toBe("pin 59");
  });

  it("is empty for a chat with no pins, an error for another user, refused for anon", async () => {
    expect(await rpc<Msg[]>(b, "get_pinned_messages", { companion_id: bc.id })).toEqual([]);
    expect(await rpcError(a.client, "get_pinned_messages", { companion_id: bc.id })).toMatch(/companion_not_found/);
    expect(await rpcError(anon, "get_pinned_messages", { companion_id: bc.id })).not.toBeNull();
  });
});

describe("delete_memory_fact", () => {
  async function addFact(u: TestUser, companionId: string, fact: string): Promise<number> {
    const { data, error } = await service.from("memory_facts").insert({ companion_id: companionId, user_id: u.id, category: "people", fact, source_day: "2026-11-01" }).select("id").single();
    if (error) throw error;
    return data.id as number;
  }
  const exists = async (id: number) => ((await service.from("memory_facts").select("id").eq("id", id)).data ?? []).length === 1;

  it("hard deletes the caller's own fact, and a second call is a quiet no-op", async () => {
    const id = await addFact(a, ac.id, "Her sister is called Meera");
    expect(await rpc<{ deleted: boolean }>(a, "delete_memory_fact", { fact_id: id })).toEqual({ deleted: true });
    expect(await exists(id)).toBe(false);
    expect(await rpc<{ deleted: boolean }>(a, "delete_memory_fact", { fact_id: id })).toEqual({ deleted: false });
  });

  it("leaves no tombstone and no block list: the same fact can be written again", async () => {
    const id = await addFact(a, ac.id, "Works at a studio");
    await rpc(a, "delete_memory_fact", { fact_id: id });
    const again = await addFact(a, ac.id, "Works at a studio");
    expect(await exists(again)).toBe(true);
  });

  it("another user cannot delete it, and neither can anon", async () => {
    const id = await addFact(a, ac.id, "Likes jasmine tea");
    expect(await rpc<{ deleted: boolean }>(b, "delete_memory_fact", { fact_id: id })).toEqual({ deleted: false });
    expect(await exists(id)).toBe(true);
    expect(await rpcError(anon, "delete_memory_fact", { fact_id: id })).not.toBeNull();
    expect(await exists(id)).toBe(true);
  });

  it("works for a locked companion and an expired plan", async () => {
    const u = await makeUser("forget-expired");
    const c = await create(u, "F09");
    const id = await addFact(u, c.id, "Hates mornings");
    await service.from("profiles").update({ trial_started_at: new Date(Date.now() - 30 * 86400000).toISOString() }).eq("id", u.id);
    expect(await rpc<{ deleted: boolean }>(u, "delete_memory_fact", { fact_id: id })).toEqual({ deleted: true });
  });
});

describe("export_my_data", () => {
  it("returns everything the caller owns, deleted messages as tombstones without text", async () => {
    const u = await makeUser("export");
    const c = await create(u, "F10");
    const [m1, m2] = await seed(u.id, c.id, 2);
    await service.from("messages").update({ text: "", deleted_at: new Date().toISOString() }).eq("id", m2);
    await service.from("memory_facts").insert({ companion_id: c.id, user_id: u.id, category: "work", fact: "Draws maps", source_day: "2026-11-01" });
    await service.from("memory_summaries").insert({ companion_id: c.id, user_id: u.id, period: "day", period_key: "2026-11-01", summary: "A quiet day." });
    await service.from("consents").insert({ user_id: u.id, version: "2026-11-v2", marketing: false });
    const d = await rpc<Record<string, unknown> & { messages: { id: number; text: string | null; deleted: boolean }[]; companions: { id: string }[] }>(u, "export_my_data");
    for (const k of ["profile", "consents", "companions", "messages", "memory_facts", "memory_summaries", "entitlement"]) expect(d).toHaveProperty(k);
    expect(d.companions.map((x) => x.id)).toEqual([c.id]);
    expect(d.messages).toHaveLength(2);
    expect(d.messages.find((m) => m.id === m1)).toMatchObject({ text: "msg 0", deleted: false });
    expect(d.messages.find((m) => m.id === m2)).toMatchObject({ text: null, deleted: true });
    expect((d.memory_facts as { fact: string }[])[0].fact).toBe("Draws maps");
    expect((d.memory_summaries as { summary: string }[])[0].summary).toBe("A quiet day.");
    expect((d.consents as { version: string }[]).map((x) => x.version)).toContain("2026-11-v2");
    expect(d.entitlement).toMatchObject({ plan: "trial" });
  });

  it("never carries hidden caps, trust points, safety events or admin fields", async () => {
    const u = await makeUser("export-private");
    const c = await create(u, "F11");
    await service.from("companions").update({ trust_points: 77, trust_level: 3 }).eq("id", c.id);
    await service.from("safety_events").insert({ user_id: u.id, companion_id: c.id, kind: "concern" });
    await service.from("user_limits").upsert({ user_id: u.id, pass_cap_override: 123 });
    await service.rpc("set_subscription", { p_user_id: u.id, p_plan: "pro", p_status: "active", p_expires_at: new Date(Date.now() + 86400000).toISOString(), p_purchase_token: "secret-token", p_product_id: "ally_pro" });
    const text = JSON.stringify(await rpc(u, "export_my_data")).toLowerCase();
    for (const banned of ["trust_points", "trust_level", "trustlevel", "highest_level", "safety", "fair_use", "pass_cap", "cap_override", "role", "plan_forced", "purchase_token", "secret-token", "user_limits", "\"77\"", ":77", ":123"]) {
      expect(text.includes(banned), `export contains ${banned}`).toBe(false);
    }
  });

  it("contains only the caller's rows, and anon is refused", async () => {
    const d = await rpc<{ messages: { companionId: string }[]; companions: { id: string }[] }>(b, "export_my_data");
    expect(d.companions.map((x) => x.id)).toEqual([bc.id]);
    expect(d.messages.every((m) => m.companionId === bc.id)).toBe(true);
    expect(await rpcError(anon, "export_my_data")).not.toBeNull();
  });
});

describe("retract_reply", () => {
  interface Setup {
    u: TestUser;
    c: { id: string };
    mine: number;
    replies: number[];
  }

  /** A chat where the user sent one message, edited it, and she answered in two bubbles. */
  async function answeredEdit(label: string, template: string, edit = true): Promise<Setup> {
    const u = await makeUser(label);
    const c = await create(u, template);
    const sent = await rpc<{ message: Msg }>(u, "send_message", { companion_id: c.id, body: "first try" });
    const mine = sent.message.id;
    if (edit) await rpc(u, "edit_message", { companion_id: c.id, message_id: mine, body: "second try" });
    const r1 = await insertRow(u.id, c.id, { who: "them", text: "her first bubble", in_reply_to: mine });
    const r2 = await insertRow(u.id, c.id, { who: "them", text: "her second bubble", in_reply_to: mine, meta: { effect: "soft" } });
    await service.from("messages").update({ meta: { reaction: "❤️" } }).eq("id", mine);
    await service.from("companions").update({ last_replied_msg: mine }).eq("id", c.id);
    return { u, c, mine, replies: [r1, r2] };
  }

  it("happy path: removes her reply for real, drops the tapback, flags regen and steps last_replied_msg back", async () => {
    const { u, c, mine, replies } = await answeredEdit("retract-ok", "F12");
    const r = await rpc<{ removedIds: number[]; message: Msg }>(u, "retract_reply", { companion_id: c.id, message_id: mine });
    expect(r.removedIds).toEqual(replies);
    expect(r.message.id).toBe(mine);
    expect(r.message.text).toBe("second try");
    expect(r.message.meta.regen).toBe(true);
    expect(r.message.meta.reaction).toBeUndefined();
    const { data } = await service.from("messages").select("id").in("id", replies);
    expect(data).toEqual([]);
    expect((await companionRow(c.id)).last_replied_msg).toBe(mine - 1);
    const s = await rpc<MyState>(u, "get_my_state");
    expect(s.messages_by_companion[c.id].map((m) => m.id)).toEqual([mine]);
  });

  it("is free: no ledger debit, no trust change", async () => {
    const { u, c, mine } = await answeredEdit("retract-free", "F13");
    await service.from("companions").update({ trust_points: 9, trust_level: 2, exchanges: 4 }).eq("id", c.id);
    const before = await companionRow(c.id);
    const usedBefore = await ledgerRow(u.id);
    await rpc(u, "retract_reply", { companion_id: c.id, message_id: mine });
    const after = await companionRow(c.id);
    expect(await ledgerRow(u.id)).toBe(usedBefore);
    for (const k of ["trust_points", "trust_level", "highest_level", "exchanges", "level_changed_at", "cool_off_until", "safety_until"]) expect(after[k], k).toEqual(before[k]);
  });

  it("the reply route's claim works again: last_replied_msg is below the message", async () => {
    const { u, c, mine } = await answeredEdit("retract-claim", "F14");
    await rpc(u, "retract_reply", { companion_id: c.id, message_id: mine });
    const { data } = await service.from("companions").update({ last_replied_msg: mine }).eq("id", c.id).lt("last_replied_msg", mine).select("id");
    expect(data).toHaveLength(1);
  });

  it("not_latest when a newer message of the user's exists", async () => {
    const { u, c, mine } = await answeredEdit("retract-newer", "F15");
    await rpc(u, "send_message", { companion_id: c.id, body: "and another thing" });
    expect(await rpcError(u.client, "retract_reply", { companion_id: c.id, message_id: mine })).toBe("not_latest");
  });

  it("not_latest when a later row of hers answers something else", async () => {
    const { u, c, mine } = await answeredEdit("retract-other", "F16");
    await insertRow(u.id, c.id, { who: "them", text: "a proactive ping", meta: { proactive: true } });
    expect(await rpcError(u.client, "retract_reply", { companion_id: c.id, message_id: mine })).toBe("not_latest");
  });

  it("refused for an unedited message", async () => {
    const { u, c, mine } = await answeredEdit("retract-unedited", "M01", false);
    expect(await rpcError(u.client, "retract_reply", { companion_id: c.id, message_id: mine })).toBe("not_allowed");
  });

  it("refused for a deleted message, one of hers, or one that is not in the chat", async () => {
    const { u, c, mine, replies } = await answeredEdit("retract-bad", "M02");
    expect(await rpcError(u.client, "retract_reply", { companion_id: c.id, message_id: replies[0] })).toBe("not_allowed");
    expect(await rpcError(u.client, "retract_reply", { companion_id: c.id, message_id: 987654321 })).toBe("not_allowed");
    await rpc(u, "delete_message", { companion_id: c.id, message_id: mine });
    expect(await rpcError(u.client, "retract_reply", { companion_id: c.id, message_id: mine })).toBe("not_allowed");
  });

  it("refused when the plan has expired", async () => {
    const { u, c, mine } = await answeredEdit("retract-expired", "M03");
    await service.from("profiles").update({ trial_started_at: new Date(Date.now() - 30 * 86400000).toISOString() }).eq("id", u.id);
    expect(await rpcError(u.client, "retract_reply", { companion_id: c.id, message_id: mine })).toBe("not_allowed");
    const { data } = await service.from("messages").select("id").eq("companion_id", c.id).eq("who", "them");
    expect(data).toHaveLength(2);
  });

  it("refused for a locked companion (outside the plan's slots)", async () => {
    const u = await makeUser("retract-locked");
    await service.rpc("set_subscription", { p_user_id: u.id, p_plan: "ultra", p_status: "active", p_expires_at: new Date(Date.now() + 86400000).toISOString(), p_purchase_token: `tok-${randomUUID()}`, p_product_id: "ally_ultra" });
    await create(u, "M04");
    const second = await create(u, "M05");
    const sent = await rpc<{ message: Msg }>(u, "send_message", { companion_id: second.id, body: "hello" });
    await rpc(u, "edit_message", { companion_id: second.id, message_id: sent.message.id, body: "hello there" });
    await insertRow(u.id, second.id, { who: "them", text: "hi", in_reply_to: sent.message.id });
    // Down to one slot: the second companion is paused by the plan.
    await service.rpc("set_subscription", { p_user_id: u.id, p_plan: "pro", p_status: "active", p_expires_at: new Date(Date.now() + 86400000).toISOString(), p_purchase_token: `tok-${randomUUID()}`, p_product_id: "ally_pro" });
    expect(await rpcError(u.client, "retract_reply", { companion_id: second.id, message_id: sent.message.id })).toBe("not_allowed");
  });

  it("refused for a paused companion", async () => {
    const { u, c, mine } = await answeredEdit("retract-paused", "M06");
    await service.from("companions").update({ paused_reason: "age_check" }).eq("id", c.id);
    expect(await rpcError(u.client, "retract_reply", { companion_id: c.id, message_id: mine })).toBe("not_allowed");
  });

  it("another user gets companion_not_found and anon is refused", async () => {
    const { c, mine } = await answeredEdit("retract-owner", "M07");
    expect(await rpcError(b.client, "retract_reply", { companion_id: c.id, message_id: mine })).toMatch(/companion_not_found/);
    expect(await rpcError(anon, "retract_reply", { companion_id: c.id, message_id: mine })).not.toBeNull();
  });

  it("write_live_reply clears meta.regen from the answered message in the same write", async () => {
    const { u, c, mine } = await answeredEdit("retract-clear", "M08");
    await rpc(u, "retract_reply", { companion_id: c.id, message_id: mine });
    const { data: flagged } = await service.from("messages").select("meta").eq("id", mine).single();
    expect(flagged?.meta).toMatchObject({ regen: true });
    const { data: written, error } = await service.rpc("write_live_reply", {
      p: { companionId: c.id, userMessageId: mine, reaction: "❤️", bubbles: [{ text: "second answer", meta: {} }], trust: null, day: null, events: [] },
    });
    expect(error).toBeNull();
    expect((written as { discarded: boolean }).discarded).toBe(false);
    const { data: after } = await service.from("messages").select("meta").eq("id", mine).single();
    expect(after?.meta).not.toHaveProperty("regen");
    expect(after?.meta).toMatchObject({ reaction: "❤️" });
    const { data: replies } = await service.from("messages").select("text").eq("companion_id", c.id).eq("who", "them");
    expect(replies).toEqual([{ text: "second answer" }]);
    // The skipped trust write left the stored progress alone.
    expect((await companionRow(c.id)).trust_points).toBe(0);
  });
});

describe("grants", () => {
  it("none of the new functions is callable by anon", async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [
      ["get_messages_before", { companion_id: "c_x", before_id: 1 }],
      ["get_pinned_messages", { companion_id: "c_x" }],
      ["delete_memory_fact", { fact_id: 1 }],
      ["retract_reply", { companion_id: "c_x", message_id: 1 }],
      ["export_my_data", undefined],
    ];
    for (const [fn, args] of calls) expect(await rpcError(anon, fn, args), fn).not.toBeNull();
  });
});
