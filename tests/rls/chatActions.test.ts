import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// B3 edit / delete / reply and the QA tools
// (supabase/migrations/20261024000001_qa_role.sql, 20261024000002_chat_actions_qa.sql),
// against the local Supabase stack (`npm run db:start`, `npm run e2e:env`).
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

async function makeUser(label: string, role?: "admin" | "qa"): Promise<TestUser> {
  const email = `rlsb3+${label}-${randomUUID()}@example.com`;
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

async function rpc<T = Record<string, unknown>>(u: TestUser, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await u.client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
}

interface Msg {
  id: number;
  who: string;
  text: string;
  meta: Record<string, unknown>;
  editedAt: number | null;
  deleted: boolean;
}

let user: TestUser;
let other: TestUser;
let qa: TestUser;
let adm: TestUser;
let uc: { id: string };
let oc: { id: string };
let qc: { id: string };

const send = (u: TestUser, companion: string, body: string, reply_to: number | null = null) =>
  rpc<{ blocked: boolean; message: Msg }>(u, "send_message", { companion_id: companion, body, reply_to });

async function hers(companion: string, userId: string, text: string, meta: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await service.from("messages").insert({ companion_id: companion, user_id: userId, who: "them", text, meta }).select("id").single();
  if (error) throw error;
  return data.id as number;
}

beforeAll(async () => {
  user = await makeUser("user");
  other = await makeUser("other");
  qa = await makeUser("qa", "qa");
  adm = await makeUser("adm", "admin");
  const mk = (u: TestUser) =>
    rpc<{ id: string }>(u, "create_companion", { template_id: "F01", deck_gender: "woman", answers: ANSWERS, core: ROMANTIC, display_name: "" });
  uc = await mk(user);
  oc = await mk(other);
  qc = await mk(qa);
});

afterAll(async () => {
  for (const id of createdIds) await service.auth.admin.deleteUser(id);
});

describe("reply", () => {
  it("send_message stores the quote in meta.quoteId", async () => {
    const first = await send(user, uc.id, "first");
    const second = await send(user, uc.id, "second", first.message.id);
    expect(second.message.meta.quoteId).toBe(first.message.id);
    expect(first.message.meta.quoteId).toBeUndefined();
  });
  it("a quote must be a live message in the same chat", async () => {
    const foreign = await send(other, oc.id, "not yours");
    await expect(send(user, uc.id, "x", foreign.message.id)).rejects.toThrow(/quote_not_found/);
    await expect(send(user, uc.id, "x", 999_999_999)).rejects.toThrow(/quote_not_found/);
    const gone = await send(user, uc.id, "to delete");
    await rpc(user, "delete_message", { companion_id: uc.id, message_id: gone.message.id });
    await expect(send(user, uc.id, "x", gone.message.id)).rejects.toThrow(/quote_not_found/);
  });
});

describe("edit", () => {
  it("edits your own message, marks it, and spends nothing", async () => {
    const before = await rpc<{ ledger: { freeUsed: number } }>(user, "qa_refill_messages").catch(() => null);
    expect(before).toBeNull(); // a plain user is not QA
    const m = await send(user, uc.id, "typo");
    const { data: led0 } = await service.from("ledgers").select("free_used").eq("user_id", user.id).single();
    const r = await rpc<{ message: Msg }>(user, "edit_message", { companion_id: uc.id, message_id: m.message.id, body: "fixed" });
    expect(r.message.text).toBe("fixed");
    expect(r.message.editedAt).not.toBeNull();
    const { data: led1 } = await service.from("ledgers").select("free_used").eq("user_id", user.id).single();
    expect(led1?.free_used).toBe(led0?.free_used);
  });
  it("refuses an empty body, her messages, someone else's chat and a deleted message", async () => {
    const m = await send(user, uc.id, "mine");
    await expect(rpc(user, "edit_message", { companion_id: uc.id, message_id: m.message.id, body: "   " })).rejects.toThrow(/empty_message/);
    const herId = await hers(uc.id, user.id, "hello from her");
    await expect(rpc(user, "edit_message", { companion_id: uc.id, message_id: herId, body: "x" })).rejects.toThrow(/message_not_found/);
    await expect(rpc(other, "edit_message", { companion_id: uc.id, message_id: m.message.id, body: "x" })).rejects.toThrow(/companion_not_found/);
    await rpc(user, "delete_message", { companion_id: uc.id, message_id: m.message.id });
    await expect(rpc(user, "edit_message", { companion_id: uc.id, message_id: m.message.id, body: "x" })).rejects.toThrow(/message_deleted/);
  });
  it("closes after 15 minutes", async () => {
    const m = await send(user, uc.id, "old");
    await service.from("messages").update({ created_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() }).eq("id", m.message.id);
    await expect(rpc(user, "edit_message", { companion_id: uc.id, message_id: m.message.id, body: "late" })).rejects.toThrow(/edit_window_closed/);
  });
  it("allows 5 edits and refuses the 6th", async () => {
    const m = await send(user, uc.id, "v0");
    for (let i = 1; i <= 5; i++) await rpc(user, "edit_message", { companion_id: uc.id, message_id: m.message.id, body: `v${i}` });
    await expect(rpc(user, "edit_message", { companion_id: uc.id, message_id: m.message.id, body: "v6" })).rejects.toThrow(/edit_limit/);
  });
});

describe("delete", () => {
  it("erases the text, keeps a tombstone, and is idempotent", async () => {
    const m = await send(user, uc.id, "secret words");
    const a = await rpc<{ message: Msg }>(user, "delete_message", { companion_id: uc.id, message_id: m.message.id });
    const b = await rpc<{ message: Msg }>(user, "delete_message", { companion_id: uc.id, message_id: m.message.id });
    expect(a.message).toMatchObject({ text: "", deleted: true });
    expect(b.message.deleted).toBe(true);
    const { data } = await service.from("messages").select("text,deleted_at").eq("id", m.message.id).single();
    expect(data?.text).toBe("");
    expect(data?.deleted_at).not.toBeNull();
  });
  it("can delete her message too, keeping only the keys the caps count", async () => {
    const id = await hers(uc.id, user.id, "a shout", { effect: "loud", reaction: "x", quoteId: 1 });
    const r = await rpc<{ message: Msg }>(user, "delete_message", { companion_id: uc.id, message_id: id });
    expect(r.message.meta).toEqual({ effect: "loud" });
  });
  it("never reaches another user's message", async () => {
    const m = await send(other, oc.id, "theirs");
    await expect(rpc(user, "delete_message", { companion_id: uc.id, message_id: m.message.id })).rejects.toThrow(/message_not_found/);
    await expect(rpc(user, "delete_message", { companion_id: oc.id, message_id: m.message.id })).rejects.toThrow(/companion_not_found/);
  });
  it("get_my_state returns tombstones with deleted: true", async () => {
    const m = await send(user, uc.id, "will vanish");
    await rpc(user, "delete_message", { companion_id: uc.id, message_id: m.message.id });
    const st = await rpc<{ messages_by_companion: Record<string, Msg[]> }>(user, "get_my_state");
    expect(st.messages_by_companion[uc.id].find((x) => x.id === m.message.id)).toMatchObject({ text: "", deleted: true });
  });
  it("a client still cannot write messages directly", async () => {
    const m = await send(user, uc.id, "direct");
    const upd = await user.client.from("messages").update({ text: "hacked" }).eq("id", m.message.id);
    expect(upd.error).not.toBeNull();
    const del = await user.client.from("messages").delete().eq("id", m.message.id);
    expect(del.error).not.toBeNull();
  });
});

describe("QA tools", () => {
  it("is_qa is true for qa and admin, false for a plain user", async () => {
    expect(await rpc<boolean>(qa, "is_qa")).toBe(true);
    expect(await rpc<boolean>(adm, "is_qa")).toBe(true);
    expect(await rpc<boolean>(user, "is_qa")).toBe(false);
  });
  it("every qa_* call refuses a plain user", async () => {
    await expect(rpc(user, "qa_set_level", { companion_id: uc.id, lvl: 4 })).rejects.toThrow(/42501/);
    await expect(rpc(user, "qa_set_freeze", { companion_id: uc.id, freeze: true })).rejects.toThrow(/42501/);
    await expect(rpc(user, "qa_state", { companion_id: uc.id })).rejects.toThrow(/42501/);
    await expect(rpc(user, "qa_refill_messages")).rejects.toThrow(/42501/);
    await expect(rpc(user, "qa_reset_chat", { companion_id: uc.id })).rejects.toThrow(/42501/);
  });
  it("qa_set_level sets level, parks points on the threshold, and stamps the change", async () => {
    const r = await rpc<{ trustLevel: number; levelChangedAt: number }>(qa, "qa_set_level", { companion_id: qc.id, lvl: 4 });
    expect(r.trustLevel).toBe(4);
    const { data } = await service.from("companions").select("trust_level,trust_points,highest_level,level_changed_at").eq("id", qc.id).single();
    expect(data).toMatchObject({ trust_level: 4, trust_points: 90, highest_level: 4 });
    expect(data?.level_changed_at).not.toBeNull();
    await rpc(qa, "qa_set_level", { companion_id: qc.id, lvl: 2 });
    const down = await service.from("companions").select("trust_level,trust_points,highest_level").eq("id", qc.id).single();
    expect(down.data).toMatchObject({ trust_level: 2, trust_points: 15, highest_level: 4 });
  });
  it("rejects a level outside 1 to 6", async () => {
    await expect(rpc(qa, "qa_set_level", { companion_id: qc.id, lvl: 0 })).rejects.toThrow(/bad_level/);
    await expect(rpc(qa, "qa_set_level", { companion_id: qc.id, lvl: 7 })).rejects.toThrow(/bad_level/);
  });
  it("works on your own companions only, even for an admin", async () => {
    await expect(rpc(qa, "qa_set_level", { companion_id: uc.id, lvl: 6 })).rejects.toThrow(/companion_not_found/);
    await expect(rpc(adm, "qa_reset_chat", { companion_id: uc.id })).rejects.toThrow(/companion_not_found/);
  });
  it("freeze holds and lifts without touching the level", async () => {
    const on = await rpc<{ frozen: boolean }>(qa, "qa_set_freeze", { companion_id: qc.id, freeze: true });
    expect(on.frozen).toBe(true);
    expect((await rpc<{ frozen: boolean; level: number }>(qa, "qa_state", { companion_id: qc.id })).frozen).toBe(true);
    const off = await rpc<{ frozen: boolean }>(qa, "qa_set_freeze", { companion_id: qc.id, freeze: false });
    expect(off.frozen).toBe(false);
    const { data } = await service.from("companions").select("trust_level").eq("id", qc.id).single();
    expect(data?.trust_level).toBe(2);
  });
  it("qa_state reports points, the next threshold and today's effects", async () => {
    await hers(qc.id, qa.id, "x", { effect: "shake" });
    await hers(qc.id, qa.id, "y", { effect: "shake" });
    await hers(qc.id, qa.id, "z", { screen: "balloons" });
    const s = await rpc<{ level: number; points: number; nextThreshold: number; effectsToday: Record<string, number>; screensToday: number }>(qa, "qa_state", { companion_id: qc.id });
    expect(s).toMatchObject({ level: 2, points: 15, nextThreshold: 45, screensToday: 1 });
    expect(s.effectsToday.shake).toBe(2);
  });
  it("qa_refill_messages zeroes today's use", async () => {
    await send(qa, qc.id, "uses one");
    const r = await rpc<{ ledger: { freeUsed: number } }>(qa, "qa_refill_messages");
    expect(r.ledger.freeUsed).toBe(0);
  });
  it("qa_reset_chat wipes messages and counters, and keeps the level", async () => {
    await rpc(qa, "qa_reset_chat", { companion_id: qc.id });
    const { count } = await service.from("messages").select("id", { count: "exact", head: true }).eq("companion_id", qc.id);
    expect(count).toBe(0);
    const { data } = await service.from("companions").select("exchanges,last_replied_msg,trust_level").eq("id", qc.id).single();
    expect(data).toMatchObject({ exchanges: 0, last_replied_msg: 0, trust_level: 2 });
  });
});
