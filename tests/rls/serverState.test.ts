import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { dayKey } from "@/lib/clock";
import { FREE_DAILY, MAX_COMPANIONS, PASS_CAP, PART_PURGE_DAYS, PRICE_DAY_PASS } from "@/lib/config";

// P2 server state (supabase/migrations/20260924000001_server_state.sql),
// against the local Supabase stack (`npm run db:start`, `npm run e2e:env`).
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
const SECRET = process.env.SUPABASE_SECRET_KEY as string;
const CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";

const TABLES = ["companions", "messages", "ledgers", "ledger_unlocks", "ledger_passes", "ledger_parted"] as const;
type Table = (typeof TABLES)[number];

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SECRET, noPersist);
const createdIds: string[] = [];

interface TestUser {
  id: string;
  client: SupabaseClient;
}

async function makeUser(label: string): Promise<TestUser> {
  const email = `rls2+${label}-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  createdIds.push(data.user.id);
  const client = createClient(URL, PUBLISHABLE, noPersist);
  const signIn = await client.auth.signInWithPassword({ email, password, options: { captchaToken: CAPTCHA } });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

async function makeAnonymous(): Promise<TestUser> {
  const client = createClient(URL, PUBLISHABLE, noPersist);
  const { data, error } = await client.auth.signInAnonymously({ options: { captchaToken: CAPTCHA } });
  if (error || !data.user) throw error ?? new Error("anonymous sign-in failed");
  createdIds.push(data.user.id);
  return { id: data.user.id, client };
}

const ANSWERS = { q5: 0.4, q6: 0.5, q7: 0.5, q8: 0.38, q9: 0.5, q10: "head", q11: ["music"] };
const CORE = { primary: "MEHER", secondary: null, weight: 100, ranked: [{ id: "MEHER", score: 0.9 }] };

async function rpc<T = Record<string, unknown>>(u: TestUser, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await u.client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
}

async function createCompanion(u: TestUser, templateId: string, displayName = ""): Promise<{ id: string }> {
  return rpc(u, "create_companion", {
    template_id: templateId,
    deck_gender: templateId.startsWith("F") ? "woman" : "man",
    answers: ANSWERS,
    core: CORE,
    display_name: displayName,
  });
}

async function countRows(table: Table, uid: string): Promise<number> {
  const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq("user_id", uid);
  if (error) throw error;
  return count ?? 0;
}

async function ledgerRow(uid: string) {
  const { data, error } = await admin.from("ledgers").select("*").eq("user_id", uid).single();
  if (error) throw error;
  return data as { day: string; free_used: number; slots_unlocked: number; pass_used: number | null; pass_ends_at: string | null };
}

/** Gives a user at least one row in each of the six tables, through the RPCs only. */
async function populate(u: TestUser): Promise<{ activeId: string }> {
  await rpc(u, "unlock_slot", { amount: 199 }); // ledgers + ledger_unlocks
  const first = await createCompanion(u, "F01");
  await rpc(u, "send_message", { companion_id: first.id, body: "hello" }); // messages
  await rpc(u, "buy_pass"); // ledger_passes
  const second = await createCompanion(u, "M01");
  await rpc(u, "part_companion", { companion_id: second.id }); // ledger_parted
  return { activeId: first.id };
}

let a: TestUser;
let b: TestUser;
let bActiveId: string;

beforeAll(async () => {
  expect(URL, "run `npm run e2e:env` first").toBeTruthy();
  a = await makeUser("a");
  b = await makeUser("b");
  await populate(a);
  ({ activeId: bActiveId } = await populate(b));
});

afterAll(async () => {
  for (const id of createdIds) await admin.auth.admin.deleteUser(id);
});

describe("RLS: owner-only reads on every new table", () => {
  for (const table of TABLES) {
    it(`${table}: A reads its own rows and none of B's`, async () => {
      const own = await a.client.from(table).select("user_id").eq("user_id", a.id);
      expect(own.error).toBeNull();
      expect(own.data!.length).toBeGreaterThan(0);
      const other = await a.client.from(table).select("user_id").eq("user_id", b.id);
      expect(other.error).toBeNull();
      expect(other.data ?? []).toHaveLength(0);
      // An unfiltered select also only ever returns A's rows.
      const all = await a.client.from(table).select("user_id");
      expect((all.data ?? []).every((r) => r.user_id === a.id)).toBe(true);
      expect(await countRows(table, b.id)).toBeGreaterThan(0);
    });
  }
});

describe("grants: no direct insert/update/delete for authenticated or anon", () => {
  const sampleInsert: Record<Table, (uid: string) => Record<string, unknown>> = {
    companions: (uid) => ({ id: "c_forged" + randomUUID().slice(0, 6), user_id: uid, template_id: "F09", deck_gender: "woman", answers: {}, core: {} }),
    messages: (uid) => ({ companion_id: bActiveId, user_id: uid, who: "me", text: "forged" }),
    ledgers: (uid) => ({ user_id: uid, day: "2026-01-01", slots_unlocked: 3 }),
    ledger_unlocks: (uid) => ({ user_id: uid, slot: 3, amount: 0 }),
    ledger_passes: (uid) => ({ user_id: uid, amount: 0 }),
    ledger_parted: (uid) => ({ user_id: uid, template_id: "F16" }),
  };
  const sampleUpdate: Record<Table, Record<string, unknown>> = {
    companions: { exchanges: 0 },
    messages: { text: "edited" },
    ledgers: { free_used: 0, slots_unlocked: 3 },
    ledger_unlocks: { amount: 0 },
    ledger_passes: { amount: 0 },
    ledger_parted: { template_id: "F15" },
  };

  for (const table of TABLES) {
    it(`${table}: A's own insert, update and delete are refused with 42501`, async () => {
      const before = await countRows(table, a.id);
      const ins = await a.client.from(table).insert(sampleInsert[table](a.id));
      expect(ins.error?.code).toBe("42501");
      const upd = await a.client.from(table).update(sampleUpdate[table]).eq("user_id", a.id);
      expect(upd.error?.code).toBe("42501");
      const del = await a.client.from(table).delete().eq("user_id", a.id);
      expect(del.error?.code).toBe("42501");
      expect(await countRows(table, a.id)).toBe(before);
    });

    it(`${table}: a client with no session can neither read nor write`, async () => {
      const client = createClient(URL, PUBLISHABLE, noPersist);
      const sel = await client.from(table).select("user_id");
      expect(sel.data ?? []).toHaveLength(0);
      const ins = await client.from(table).insert(sampleInsert[table](a.id));
      expect(ins.error).not.toBeNull();
    });
  }

  it("the ledger cannot be raised by a direct write: A's slots and free count are unchanged", async () => {
    const before = await ledgerRow(a.id);
    await a.client.from("ledgers").update({ slots_unlocked: 3, free_used: 0 }).eq("user_id", a.id);
    const after = await ledgerRow(a.id);
    expect(after.slots_unlocked).toBe(before.slots_unlocked);
    expect(after.free_used).toBe(before.free_used);
  });
});

describe("RPC access", () => {
  const rpcs: [string, Record<string, unknown> | undefined][] = [
    ["get_my_state", undefined],
    ["create_companion", { template_id: "F05", deck_gender: "woman", answers: ANSWERS, core: CORE, display_name: "" }],
    ["send_message", { companion_id: "c_x", body: "hi" }],
    ["receive_reply", { companion_id: "c_x", body: "hi" }],
    ["seed_opener", { companion_id: "c_x", body: "hi" }],
    ["open_chat", { companion_id: "c_x" }],
    ["part_companion", { companion_id: "c_x" }],
    ["unlock_slot", { amount: 1 }],
    ["buy_pass", undefined],
    ["set_companion_prefs", { companion_id: "c_x", notify: false }],
    ["purge_parted_now", undefined],
  ];

  for (const [fn, args] of rpcs) {
    it(`${fn} is not executable without a session`, async () => {
      const client = createClient(URL, PUBLISHABLE, noPersist);
      const { error } = await client.rpc(fn, args);
      expect(error).not.toBeNull();
    });
  }

  it("A cannot act on B's companion through any RPC", async () => {
    const before = await countRows("messages", b.id);
    for (const [fn, args] of [
      ["send_message", { companion_id: bActiveId, body: "intrusion" }],
      ["receive_reply", { companion_id: bActiveId, body: "intrusion" }],
      ["seed_opener", { companion_id: bActiveId, body: "intrusion" }],
      ["open_chat", { companion_id: bActiveId }],
      ["part_companion", { companion_id: bActiveId }],
      ["set_companion_prefs", { companion_id: bActiveId, notify: false }],
    ] as const) {
      const { error } = await a.client.rpc(fn, args);
      expect(error?.code, fn).toBe("P0002");
    }
    expect(await countRows("messages", b.id)).toBe(before);
    const { data } = await admin.from("companions").select("status,notify").eq("id", bActiveId).single();
    expect(data).toEqual({ status: "active", notify: true });
  });

  it("the private helper schema is not reachable through the API", async () => {
    const { error } = await a.client.schema("ally_private" as "public").rpc("free_daily");
    expect(error).not.toBeNull();
  });
});

describe("ledger RPCs port src/lib/ledger.ts", () => {
  let u: TestUser;
  let cid: string;
  const today = () => dayKey(Date.now());

  beforeAll(async () => {
    u = await makeUser("ledger");
    cid = (await createCompanion(u, "F02")).id;
  });

  it("send_message debits the free allowance, then blocks with 'empty' and inserts nothing", async () => {
    await admin.from("ledgers").update({ day: today(), free_used: FREE_DAILY - 1 }).eq("user_id", u.id);
    const ok = await rpc<{ blocked: boolean; status: string; exchanges: number; ledger: { freeUsed: number } }>(u, "send_message", { companion_id: cid, body: "last one" });
    expect(ok.blocked).toBe(false);
    expect(ok.ledger.freeUsed).toBe(FREE_DAILY);
    const messagesBefore = await countRows("messages", u.id);
    const blocked = await rpc<{ blocked: boolean; status: string; message: unknown }>(u, "send_message", { companion_id: cid, body: "over" });
    expect(blocked).toMatchObject({ blocked: true, status: "empty", message: null });
    expect(await countRows("messages", u.id)).toBe(messagesBefore);
    expect((await ledgerRow(u.id)).free_used).toBe(FREE_DAILY);
  });

  it("a new Asia/Kolkata day zeroes free_used (rollDay)", async () => {
    await admin.from("ledgers").update({ day: "2000-01-01", free_used: FREE_DAILY }).eq("user_id", u.id);
    const res = await rpc<{ blocked: boolean; ledger: { day: string; freeUsed: number } }>(u, "send_message", { companion_id: cid, body: "new day" });
    expect(res.blocked).toBe(false);
    expect(res.ledger.day).toBe(today());
    expect(res.ledger.freeUsed).toBe(1);
  });

  it("a pass takes over from the free allowance and caps at PASS_CAP with 'capped'", async () => {
    await admin.from("ledgers").update({ free_used: FREE_DAILY }).eq("user_id", u.id);
    const bought = await rpc<{ ledger: { pass: { used: number; endsAt: number; startedAt: number } | null; passes: { amount: number }[] } }>(u, "buy_pass");
    expect(bought.ledger.pass?.used).toBe(0);
    expect(bought.ledger.pass!.endsAt - bought.ledger.pass!.startedAt).toBe(24 * 3600000);
    expect(bought.ledger.passes.at(-1)?.amount).toBe(PRICE_DAY_PASS);

    // buy_pass is a no-op while a pass is active
    const again = await rpc<{ ledger: { passes: unknown[] } }>(u, "buy_pass");
    expect(again.ledger.passes).toHaveLength(bought.ledger.passes.length);

    const onPass = await rpc<{ blocked: boolean; ledger: { freeUsed: number; pass: { used: number } } }>(u, "send_message", { companion_id: cid, body: "on pass" });
    expect(onPass.blocked).toBe(false);
    expect(onPass.ledger.pass.used).toBe(1);
    expect(onPass.ledger.freeUsed).toBe(FREE_DAILY); // the free count is untouched while on a pass

    await admin.from("ledgers").update({ pass_used: PASS_CAP - 1 }).eq("user_id", u.id);
    const last = await rpc<{ blocked: boolean }>(u, "send_message", { companion_id: cid, body: "last on pass" });
    expect(last.blocked).toBe(false);
    const capped = await rpc<{ blocked: boolean; status: string }>(u, "send_message", { companion_id: cid, body: "capped" });
    expect(capped).toMatchObject({ blocked: true, status: "capped" });
  });

  it("an expired pass falls back to the free allowance", async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    await admin.from("ledgers").update({ pass_ends_at: past, free_used: 0 }).eq("user_id", u.id);
    const res = await rpc<{ blocked: boolean; ledger: { freeUsed: number } }>(u, "send_message", { companion_id: cid, body: "after pass" });
    expect(res.blocked).toBe(false);
    expect(res.ledger.freeUsed).toBe(1);
  });

  it("send_message increments exchanges and returns the stored 'me' message", async () => {
    const res = await rpc<{ exchanges: number; message: { who: string; text: string; at: number } }>(u, "send_message", { companion_id: cid, body: "count me" });
    expect(res.message).toMatchObject({ who: "me", text: "count me" });
    const { data } = await admin.from("companions").select("exchanges").eq("id", cid).single();
    expect(data?.exchanges).toBe(res.exchanges);
  });

  it("unlock_slot caps at MAX_COMPANIONS but records every unlock", async () => {
    let last: { ledger: { slotsUnlocked: number; unlocks: { slot: number; amount: number }[] } } | null = null;
    for (let i = 0; i < MAX_COMPANIONS + 1; i++) last = await rpc(u, "unlock_slot", { amount: 100 + i });
    expect(last!.ledger.slotsUnlocked).toBe(MAX_COMPANIONS);
    expect(last!.ledger.unlocks).toHaveLength(MAX_COMPANIONS + 1);
    expect(last!.ledger.unlocks.at(-1)).toMatchObject({ slot: MAX_COMPANIONS, amount: 100 + MAX_COMPANIONS });
  });
});

describe("create_companion", () => {
  it("enforces slots, sets the display name once, and never reuses a parted face", async () => {
    const u = await makeUser("create");
    const first = await createCompanion(u, "F03", "Riya");
    expect(first.id).toMatch(/^c_[0-9a-z]+$/);
    const profile = await admin.from("profiles").select("display_name").eq("id", u.id).single();
    expect(profile.data?.display_name).toBe("Riya");

    // one slot, one active companion
    const { error: full } = await u.client.rpc("create_companion", { template_id: "F04", deck_gender: "woman", answers: ANSWERS, core: CORE, display_name: "Other" });
    expect(full?.message).toBe("slots_full");

    await rpc(u, "part_companion", { companion_id: first.id });
    const { error: reused } = await u.client.rpc("create_companion", { template_id: "F03", deck_gender: "woman", answers: ANSWERS, core: CORE, display_name: "" });
    expect(reused?.message).toBe("template_unavailable");

    await createCompanion(u, "F04", "Other");
    const after = await admin.from("profiles").select("display_name").eq("id", u.id).single();
    expect(after.data?.display_name).toBe("Riya"); // not overwritten
  });

  it("part_companion sets purge_at PART_PURGE_DAYS out and adds the face to ledger_parted", async () => {
    const u = await makeUser("part");
    const c = await createCompanion(u, "M02");
    const res = await rpc<{ partedAt: number; purgeAt: number; ledger: { parted: string[] } }>(u, "part_companion", { companion_id: c.id });
    expect(res.purgeAt - res.partedAt).toBe(PART_PURGE_DAYS * 86400000);
    expect(res.ledger.parted).toContain("M02");
    // idempotent
    const again = await rpc<{ partedAt: number }>(u, "part_companion", { companion_id: c.id });
    expect(again.partedAt).toBe(res.partedAt);
  });

  it("seed_opener writes only into an empty conversation", async () => {
    const u = await makeUser("opener");
    const c = await createCompanion(u, "F06");
    const first = await rpc<{ message: { who: string } | null; unread: number }>(u, "seed_opener", { companion_id: c.id, body: "Hi." });
    expect(first.message?.who).toBe("them");
    expect(first.unread).toBe(1);
    const second = await rpc<{ message: unknown }>(u, "seed_opener", { companion_id: c.id, body: "Hi again." });
    expect(second.message).toBeNull();
    expect(await countRows("messages", u.id)).toBe(1);
    const opened = await rpc<{ lastOpenedAt: number }>(u, "open_chat", { companion_id: c.id });
    expect(opened.lastOpenedAt).toBeGreaterThan(0);
    const { data } = await admin.from("companions").select("unread").eq("id", c.id).single();
    expect(data?.unread).toBe(0);
  });
});

describe("purge and get_my_state", () => {
  it("get_my_state purges a parted companion past purge_at but keeps the face excluded", async () => {
    const u = await makeUser("purge");
    const c = await createCompanion(u, "F07");
    await rpc(u, "seed_opener", { companion_id: c.id, body: "Hi." });
    await rpc(u, "send_message", { companion_id: c.id, body: "hey" });
    await rpc(u, "part_companion", { companion_id: c.id });

    // Not yet due: nothing purged.
    let state = await rpc<{ companions: { id: string; core: { primary: string | null } }[]; messages_by_companion: Record<string, unknown[]> }>(u, "get_my_state");
    expect(state.messages_by_companion[c.id]).toHaveLength(2);

    // Fast-forward by moving purge_at into the past (the server clock can't be skewed).
    await admin.from("companions").update({ purge_at: new Date(Date.now() - 1000).toISOString() }).eq("id", c.id);
    state = await rpc(u, "get_my_state");
    expect(state.messages_by_companion[c.id]).toBeUndefined();
    const purged = state.companions.find((x) => x.id === c.id)!;
    expect(purged.core.primary).toBeNull();
    const { data } = await admin.from("companions").select("status,unread,answers").eq("id", c.id).single();
    expect(data).toMatchObject({ status: "parted", unread: 0, answers: { q10: null, q11: [] } });
    expect(await countRows("ledger_parted", u.id)).toBe(1);
  });

  it("get_my_state returns the client's shapes, the profile name and the latest consent", async () => {
    const u = await makeUser("state");
    await admin.from("consents").insert({ user_id: u.id, version: "test", marketing: true });
    const c = await createCompanion(u, "M03", "Kabir");
    const state = await rpc<Record<string, unknown>>(u, "get_my_state");
    expect(Math.abs((state.server_now as number) - Date.now())).toBeLessThan(60000);
    expect(state.profile).toEqual({ display_name: "Kabir" });
    expect(state.consent).toMatchObject({ marketing: true });
    const companions = state.companions as Record<string, unknown>[];
    expect(Object.keys(companions[0]).sort()).toEqual(
      ["answers", "core", "createdAt", "deckGender", "exchanges", "id", "lastOpenedAt", "messages", "notify", "partedAt", "purgeAt", "sound", "status", "templateId", "unread"].sort()
    );
    expect(companions[0]).toMatchObject({ id: c.id, templateId: "M03", deckGender: "man", status: "active", answers: ANSWERS, core: CORE });
    // freeDaily/passCap: P3's effective limits (admin override or default).
    expect(Object.keys(state.ledger as object).sort()).toEqual(["day", "freeDaily", "freeUsed", "parted", "pass", "passCap", "passes", "slotsUnlocked", "unlocks"]);
    expect(state.ledger).toMatchObject({ freeDaily: FREE_DAILY, passCap: PASS_CAP });
    expect(state).toHaveProperty("unlocks");
    expect(state).toHaveProperty("passes");
    expect(state).toHaveProperty("parted");
  });

  it("set_companion_prefs persists notify and sound", async () => {
    const u = await makeUser("prefs");
    const c = await createCompanion(u, "F08");
    const res = await rpc(u, "set_companion_prefs", { companion_id: c.id, notify: false });
    expect(res).toEqual({ notify: false, sound: true });
    const res2 = await rpc(u, "set_companion_prefs", { companion_id: c.id, sound: false });
    expect(res2).toEqual({ notify: false, sound: false });
  });
});

describe("ist_day_key matches dayKey() at the midnight IST boundary", () => {
  const instants = [
    Date.UTC(2024, 0, 15, 18, 29, 59, 999), // 23:59:59.999 IST
    Date.UTC(2024, 0, 15, 18, 30, 0, 0), // 00:00 IST
    Date.UTC(2024, 1, 29, 18, 29, 0), // leap day, 23:59 IST
    Date.UTC(2024, 11, 31, 18, 30, 0), // new year IST
    Date.UTC(2026, 8, 24, 3, 0, 0),
  ];
  for (const ms of instants) {
    it(new Date(ms).toISOString(), async () => {
      const { data, error } = await a.client.rpc("ist_day_key", { ts: new Date(ms).toISOString() });
      expect(error).toBeNull();
      expect(data).toBe(dayKey(ms));
    });
  }
});

describe("account deletion leaves nothing behind", () => {
  it("admin deleteUser (the /api/account/delete path) removes every row in the six tables", async () => {
    const u = await makeUser("delete");
    await populate(u);
    for (const t of TABLES) expect(await countRows(t, u.id), t).toBeGreaterThan(0);
    const { error } = await admin.auth.admin.deleteUser(u.id);
    expect(error).toBeNull();
    for (const t of TABLES) expect(await countRows(t, u.id), t).toBe(0);
  });

  it("purge_self for an anonymous user removes every row in the six tables", async () => {
    const u = await makeAnonymous();
    await populate(u);
    for (const t of TABLES) expect(await countRows(t, u.id), t).toBeGreaterThan(0);
    const { error } = await u.client.rpc("purge_self");
    expect(error).toBeNull();
    for (const t of TABLES) expect(await countRows(t, u.id), t).toBe(0);
  });
});
