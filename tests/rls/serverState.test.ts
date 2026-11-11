import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { dayKey } from "@/lib/clock";
import { HIDDEN_DAILY_CAPS, PART_PURGE_DAYS, PLAN_CONFIG } from "@/lib/config";

// P2 server state (supabase/migrations/20260924000001_server_state.sql) and the
// plans/trial model on top of it (20261111000001_plans_and_trial.sql), against
// the local Supabase stack (`npm run db:start`, `npm run e2e:env`).
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
const SECRET = process.env.SUPABASE_SECRET_KEY as string;
const CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";

// Tables a populated user has rows in. ledger_unlocks and ledger_passes are DEPRECATED (nothing writes them any more)
// but keep their owner-only RLS and no-write grants, so they stay in the grant checks via ALL_TABLES.
const TABLES = ["companions", "messages", "ledgers", "ledger_parted", "subscriptions"] as const;
const ALL_TABLES = [...TABLES, "ledger_unlocks", "ledger_passes"] as const;
type Table = (typeof ALL_TABLES)[number];

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

type PaidPlan = "pro" | "max" | "ultra";

/** The server-side entry point a verified Play purchase would use (service role only). */
async function grantPlan(uid: string, plan: PaidPlan, status = "active", expiresInMs = 30 * 86400000): Promise<void> {
  const { error } = await admin.rpc("set_subscription", {
    p_user_id: uid,
    p_plan: plan,
    p_status: status,
    p_expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    p_purchase_token: `tok-${uid}`,
    p_product_id: `ally_${plan}`,
  });
  if (error) throw new Error(`set_subscription: ${error.code} ${error.message}`);
}

const ANSWERS = { q5: 0.4, q6: 0.5, q7: 0.5, q8: 0.38, q9: 0.5, q10: "head", q11: ["music"] };
const CORE = { primary: "PSYCH", secondary: null, weight: 100, ranked: [{ id: "PSYCH", score: 0.9 }] };

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
  return data as { day: string; free_used: number };
}

/** Gives a user at least one row in each live table, through the RPCs (and the purchase entry point) only. */
async function populate(u: TestUser): Promise<{ activeId: string }> {
  await grantPlan(u.id, "max"); // subscriptions, and room for a second companion
  const first = await createCompanion(u, "F01");
  await rpc(u, "send_message", { companion_id: first.id, body: "hello" }); // ledgers, messages
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
    subscriptions: (uid) => ({ user_id: uid, plan: "ultra", status: "active", expires_at: "2099-01-01T00:00:00Z" }),
  };
  const sampleUpdate: Record<Table, Record<string, unknown>> = {
    companions: { exchanges: 0 },
    messages: { text: "edited" },
    ledgers: { free_used: 0, slots_unlocked: 3 },
    ledger_unlocks: { amount: 0 },
    ledger_passes: { amount: 0 },
    ledger_parted: { template_id: "F15" },
    subscriptions: { plan: "ultra", status: "active" },
  };

  for (const table of ALL_TABLES) {
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

  it("the ledger cannot be reset by a direct write: A's free count is unchanged", async () => {
    const before = await ledgerRow(a.id);
    await a.client.from("ledgers").update({ free_used: 0 }).eq("user_id", a.id);
    const after = await ledgerRow(a.id);
    expect(after.free_used).toBe(before.free_used);
  });

  it("a plan cannot be self-granted: no direct write to subscriptions or trial_started_at", async () => {
    const ins = await a.client.from("subscriptions").insert({ user_id: a.id, plan: "ultra", status: "active", expires_at: "2099-01-01T00:00:00Z" });
    expect(ins.error?.code).toBe("42501");
    const upd = await a.client.from("profiles").update({ trial_started_at: new Date().toISOString() }).eq("id", a.id);
    expect(upd.error?.code).toBe("42501");
    const forced = await a.client.from("profiles").update({ plan_forced: true }).eq("id", a.id);
    expect(forced.error?.code).toBe("42501");
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
    ["get_entitlement", undefined],
    ["mark_deeper_shown", { companion_id: "c_x" }],
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

  it("the removed day-pass and slot-unlock RPCs no longer exist", async () => {
    for (const fn of ["unlock_slot", "buy_pass"]) {
      const { error } = await a.client.rpc(fn, fn === "unlock_slot" ? { amount: 1 } : undefined);
      expect(error, fn).not.toBeNull();
      expect(error?.code, fn).not.toBe("42501"); // gone, not merely forbidden
    }
  });

  it("the private helper schema is not reachable through the API", async () => {
    const { error } = await a.client.schema("ally_private" as "public").rpc("free_daily");
    expect(error).not.toBeNull();
  });
});

describe("send_message judges the plan's allowance", () => {
  const today = () => dayKey(Date.now());
  const TRIAL_CHATS = PLAN_CONFIG.trial.dailyChats;
  type Sent = { blocked: boolean; status: string; code: string | null; message: unknown; ledger: { day: string; freeUsed: number }; entitlement: Record<string, unknown> };

  it("on the trial: 100 chats a day, then TRIAL_LIMIT, and nothing is inserted", async () => {
    const u = await makeUser("trial");
    const cid = (await createCompanion(u, "F02")).id;
    await admin.from("ledgers").update({ day: today(), free_used: TRIAL_CHATS - 1 }).eq("user_id", u.id);
    const ok = await rpc<Sent>(u, "send_message", { companion_id: cid, body: "last one" });
    expect(ok.blocked).toBe(false);
    expect(ok.ledger.freeUsed).toBe(TRIAL_CHATS);
    expect(ok.entitlement).toMatchObject({ plan: "trial", chats_left_today: 0, can_send: false, cap_reached: true });
    const before = await countRows("messages", u.id);
    const blocked = await rpc<Sent>(u, "send_message", { companion_id: cid, body: "over" });
    expect(blocked).toMatchObject({ blocked: true, status: "TRIAL_LIMIT", code: "TRIAL_LIMIT", message: null });
    expect(await countRows("messages", u.id)).toBe(before);
    expect((await ledgerRow(u.id)).free_used).toBe(TRIAL_CHATS);
  });

  it("a new Asia/Kolkata day zeroes the count", async () => {
    const u = await makeUser("rollday");
    const cid = (await createCompanion(u, "F02")).id;
    await admin.from("ledgers").update({ day: "2000-01-01", free_used: TRIAL_CHATS }).eq("user_id", u.id);
    const res = await rpc<Sent>(u, "send_message", { companion_id: cid, body: "new day" });
    expect(res.blocked).toBe(false);
    expect(res.ledger.day).toBe(today());
    expect(res.ledger.freeUsed).toBe(1);
  });

  it("on a paid plan the hidden cap stops sends with FAIR_USE_CAP, and the cap is never sent to the client", async () => {
    for (const plan of ["pro", "max", "ultra"] as const) {
      const u = await makeUser(`cap-${plan}`);
      await grantPlan(u.id, plan);
      const cid = (await createCompanion(u, "F02")).id;
      const cap = HIDDEN_DAILY_CAPS[plan];
      await admin.from("ledgers").update({ day: today(), free_used: cap - 1 }).eq("user_id", u.id);
      const last = await rpc<Sent>(u, "send_message", { companion_id: cid, body: "last" });
      expect(last.blocked, plan).toBe(false);
      expect(last.entitlement).toMatchObject({ plan, chats_left_today: null, can_send: false, cap_reached: true });
      expect(JSON.stringify(last.entitlement)).not.toContain(String(cap));
      const capped = await rpc<Sent>(u, "send_message", { companion_id: cid, body: "capped" });
      expect(capped, plan).toMatchObject({ blocked: true, status: "FAIR_USE_CAP", message: null });
    }
  });

  it("once the trial is over with no plan: PLAN_EXPIRED, and a cancelled-but-unexpired plan still sends", async () => {
    const u = await makeUser("expired");
    const cid = (await createCompanion(u, "F02")).id;
    await admin.from("profiles").update({ trial_started_at: new Date(Date.now() - 8 * 86400000).toISOString() }).eq("id", u.id);
    const expired = await rpc<Sent>(u, "send_message", { companion_id: cid, body: "too late" });
    expect(expired).toMatchObject({ blocked: true, status: "PLAN_EXPIRED", message: null });
    expect(expired.entitlement).toMatchObject({ plan: "expired", can_send: false, slot_limit: 0 });

    await grantPlan(u.id, "pro", "cancelled", 86400000); // cancelled, paid up for another day
    const ok = await rpc<Sent>(u, "send_message", { companion_id: cid, body: "still paid" });
    expect(ok.blocked).toBe(false);
  });

  it("a companion outside the plan's active slots takes no messages: COMPANION_LOCKED", async () => {
    const u = await makeUser("locked");
    await grantPlan(u.id, "max");
    const first = await createCompanion(u, "F02");
    const second = await createCompanion(u, "M02");
    await grantPlan(u.id, "pro"); // downgrade: one slot, the first by creation stays active
    const locked = await rpc<Sent>(u, "send_message", { companion_id: second.id, body: "hello?" });
    expect(locked).toMatchObject({ blocked: true, status: "COMPANION_LOCKED", message: null });
    const open = await rpc<Sent>(u, "send_message", { companion_id: first.id, body: "hello" });
    expect(open.blocked).toBe(false);
    // parting the first frees the slot, so the second is no longer locked
    await rpc(u, "part_companion", { companion_id: first.id });
    const nowOpen = await rpc<Sent>(u, "send_message", { companion_id: second.id, body: "hello again" });
    expect(nowOpen.blocked).toBe(false);
  });

  it("send_message increments exchanges and returns the stored 'me' message", async () => {
    const u = await makeUser("exchanges");
    const cid = (await createCompanion(u, "F02")).id;
    const res = await rpc<{ exchanges: number; message: { who: string; text: string; at: number } }>(u, "send_message", { companion_id: cid, body: "count me" });
    expect(res.message).toMatchObject({ who: "me", text: "count me" });
    const { data } = await admin.from("companions").select("exchanges").eq("id", cid).single();
    expect(data?.exchanges).toBe(res.exchanges);
  });
});

describe("create_companion", () => {
  it("enforces slots, sets the display name once, and never reuses a parted face", async () => {
    const u = await makeUser("create");
    const first = await createCompanion(u, "F03", "Riya");
    expect(first.id).toMatch(/^c_[0-9a-z]+$/);
    const profile = await admin.from("profiles").select("display_name").eq("id", u.id).single();
    expect(profile.data?.display_name).toBe("Riya");

    // the trial has one slot, one active companion
    const { error: full } = await u.client.rpc("create_companion", { template_id: "F04", deck_gender: "woman", answers: ANSWERS, core: CORE, display_name: "Other" });
    expect(full?.message).toBe("SLOT_LIMIT");

    await rpc(u, "part_companion", { companion_id: first.id });
    const { error: reused } = await u.client.rpc("create_companion", { template_id: "F03", deck_gender: "woman", answers: ANSWERS, core: CORE, display_name: "" });
    expect(reused?.message).toBe("template_unavailable");

    await createCompanion(u, "F04", "Other");
    const after = await admin.from("profiles").select("display_name").eq("id", u.id).single();
    expect(after.data?.display_name).toBe("Riya"); // not overwritten
  });

  it("slots follow the plan: 1 on the trial, Pro 1, Max 2, Ultra 4, expired 0", async () => {
    const tryCreate = (u: TestUser, t: string) => u.client.rpc("create_companion", { template_id: t, deck_gender: t.startsWith("F") ? "woman" : "man", answers: ANSWERS, core: CORE, display_name: "" });
    const faces = ["F09", "F10", "F11", "F12", "F13"];
    const expectedSlots: Record<string, number> = { pro: PLAN_CONFIG.tiers.pro.slots, max: PLAN_CONFIG.tiers.max.slots, ultra: PLAN_CONFIG.tiers.ultra.slots };
    for (const plan of ["pro", "max", "ultra"] as const) {
      const u = await makeUser(`slots-${plan}`);
      await grantPlan(u.id, plan);
      let made = 0;
      for (const t of faces) {
        const { error } = await tryCreate(u, t);
        if (error) {
          expect(error.message, plan).toBe("SLOT_LIMIT");
          break;
        }
        made++;
      }
      expect(made, plan).toBe(expectedSlots[plan]);
    }
    const expired = await makeUser("slots-expired");
    await admin.from("profiles").update({ trial_started_at: new Date(Date.now() - 9 * 86400000).toISOString() }).eq("id", expired.id);
    expect((await tryCreate(expired, "F09")).error?.message).toBe("SLOT_LIMIT");
  });

  it("parted companions do not count against the slots", async () => {
    const u = await makeUser("slots-parted");
    await grantPlan(u.id, "pro");
    const first = await createCompanion(u, "F09");
    await rpc(u, "part_companion", { companion_id: first.id });
    await createCompanion(u, "F10"); // a parted one does not hold the slot
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
    // F08 is a Trainer face and the test core is PSYCH, so the companion is mismatched and stays on the mocked path
    // (F07 is a live Psych face for everyone since B7, and seed_opener refuses a live companion).
    const c = await createCompanion(u, "F08");
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
      // B2 adds trustLevel, levelChangedAt, pausedReason and lastCtxDay; B4 adds live; plans add deeperLevelAvailable and deeperShown; never trust points.
      ["answers", "core", "createdAt", "deckGender", "deeperLevelAvailable", "deeperShown", "exchanges", "id", "lastCtxDay", "lastOpenedAt", "levelChangedAt", "live", "messages", "notify", "partedAt", "pausedReason", "purgeAt", "sound", "status", "templateId", "trustLevel", "unread"].sort()
    );
    expect(companions[0]).toMatchObject({ id: c.id, templateId: "M03", deckGender: "man", status: "active", answers: ANSWERS, core: CORE });
    // The ledger is just the day's counter and the parted faces; the plan lives in `entitlement`.
    expect(Object.keys(state.ledger as object).sort()).toEqual(["day", "freeUsed", "parted"]);
    expect(state.entitlement).toMatchObject({ plan: "trial", slot_limit: 1, max_level: 5, can_send: true, chats_left_today: PLAN_CONFIG.trial.dailyChats, cap_reached: false });
    expect(state).not.toHaveProperty("unlocks");
    expect(state).not.toHaveProperty("passes");
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
  it("admin deleteUser (the /api/account/delete path) removes every row in the live tables", async () => {
    const u = await makeUser("delete");
    await populate(u);
    for (const t of TABLES) expect(await countRows(t, u.id), t).toBeGreaterThan(0);
    const { error } = await admin.auth.admin.deleteUser(u.id);
    expect(error).toBeNull();
    for (const t of TABLES) expect(await countRows(t, u.id), t).toBe(0);
  });

  it("purge_self for an anonymous user removes every row in the live tables", async () => {
    const u = await makeAnonymous();
    await populate(u);
    for (const t of TABLES) expect(await countRows(t, u.id), t).toBeGreaterThan(0);
    const { error } = await u.client.rpc("purge_self");
    expect(error).toBeNull();
    for (const t of TABLES) expect(await countRows(t, u.id), t).toBe(0);
  });
});
