import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { HIDDEN_DAILY_CAPS, PLAN_CONFIG } from "@/lib/config";

// Plans and trial (supabase/migrations/20261111000001_plans_and_trial.sql),
// against the local Supabase stack (`npm run db:start`, `npm run e2e:env`).
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
const SECRET = process.env.SUPABASE_SECRET_KEY as string;
const CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(URL, SECRET, noPersist);
const createdIds: string[] = [];
const DAY = 86400000;

interface TestUser {
  id: string;
  client: SupabaseClient;
}

async function makeUser(label: string, role?: "admin" | "qa"): Promise<TestUser> {
  const email = `plans+${label}-${randomUUID()}@example.com`;
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

async function rpc<T = Record<string, unknown>>(u: TestUser, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await u.client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
}

type Plan = "trial" | "expired" | "pro" | "max" | "ultra";

async function effectivePlan(uid: string): Promise<Plan> {
  const { data, error } = await service.rpc("effective_plan", { p_user_id: uid });
  if (error) throw error;
  return data as Plan;
}

async function setSub(uid: string, plan: "pro" | "max" | "ultra", status: "active" | "cancelled" | "expired", expiresInMs: number | null) {
  const { error } = await service.rpc("set_subscription", {
    p_user_id: uid,
    p_plan: plan,
    p_status: status,
    p_expires_at: expiresInMs === null ? null : new Date(Date.now() + expiresInMs).toISOString(),
    p_purchase_token: `tok-${uid}`,
    p_product_id: `ally_${plan}`,
  });
  if (error) throw new Error(`set_subscription: ${error.code} ${error.message}`);
}

async function setTrialStart(uid: string, msAgo: number) {
  const { error } = await service.from("profiles").update({ trial_started_at: new Date(Date.now() - msAgo).toISOString() }).eq("id", uid);
  if (error) throw error;
}

const ANSWERS = { q5: 0.4, q6: 0.5, q7: 0.5, q8: 0.38, q9: 0.5, q10: "head", q11: ["music"] };
const CORE = { primary: "ROMANTIC", secondary: null, weight: 100, ranked: [{ id: "ROMANTIC", score: 0.9 }] };
const create = (u: TestUser, t: string) =>
  rpc<{ id: string }>(u, "create_companion", { template_id: t, deck_gender: t.startsWith("F") ? "woman" : "man", answers: ANSWERS, core: CORE, display_name: "" });

let a: TestUser;
let b: TestUser;

beforeAll(async () => {
  expect(URL, "run `npm run e2e:env` first").toBeTruthy();
  a = await makeUser("a");
  b = await makeUser("b");
});

afterAll(async () => {
  for (const id of createdIds) await service.auth.admin.deleteUser(id);
});

describe("effective_plan boundaries", () => {
  it("a new user is on the trial; the 7th day is still the trial, the 8th is expired", async () => {
    const u = await makeUser("trial");
    expect(await effectivePlan(u.id)).toBe("trial");
    await setTrialStart(u.id, 6 * DAY + 23 * 3600000); // day 7, an hour before it ends
    expect(await effectivePlan(u.id)).toBe("trial");
    await setTrialStart(u.id, 7 * DAY + 1000); // just past 7 days: day 8
    expect(await effectivePlan(u.id)).toBe("expired");
  });

  it("an active subscription wins over an expired trial; an expired one does not", async () => {
    const u = await makeUser("sub");
    await setTrialStart(u.id, 30 * DAY);
    await setSub(u.id, "max", "active", DAY);
    expect(await effectivePlan(u.id)).toBe("max");
    await setSub(u.id, "max", "active", -60000); // lapsed a minute ago
    expect(await effectivePlan(u.id)).toBe("expired");
  });

  it("a cancelled subscription keeps its plan until expires_at, then falls back", async () => {
    const u = await makeUser("cancelled");
    await setTrialStart(u.id, 30 * DAY);
    await setSub(u.id, "pro", "cancelled", DAY);
    expect(await effectivePlan(u.id)).toBe("pro");
    await setSub(u.id, "pro", "cancelled", -1000);
    expect(await effectivePlan(u.id)).toBe("expired");
  });

  it("a status of 'expired' never grants a plan, even with a future expires_at", async () => {
    const u = await makeUser("statusexpired");
    await setTrialStart(u.id, 30 * DAY);
    await setSub(u.id, "ultra", "expired", DAY);
    expect(await effectivePlan(u.id)).toBe("expired");
  });

  it("a paid plan still in force beats a trial that is still running", async () => {
    const u = await makeUser("both");
    await setSub(u.id, "ultra", "active", DAY);
    expect(await effectivePlan(u.id)).toBe("ultra");
  });
});

describe("get_entitlement per plan", () => {
  type Ent = { plan: string; trial_ends_at: number | null; slot_limit: number; max_level: number; can_send: boolean; chats_left_today: number | null; cap_reached: boolean };

  it("trial: 1 slot, level 5, the visible chat count, an end date", async () => {
    const u = await makeUser("ent-trial");
    const e = await rpc<Ent>(u, "get_entitlement");
    expect(e).toMatchObject({ plan: "trial", slot_limit: PLAN_CONFIG.trial.slots, max_level: PLAN_CONFIG.trial.maxLevel, can_send: true, chats_left_today: PLAN_CONFIG.trial.dailyChats, cap_reached: false });
    expect(e.trial_ends_at).toBeGreaterThan(Date.now());
  });

  it("expired: no slots, cannot send, no counter", async () => {
    const u = await makeUser("ent-expired");
    await setTrialStart(u.id, 9 * DAY);
    const e = await rpc<Ent>(u, "get_entitlement");
    expect(e).toMatchObject({ plan: "expired", slot_limit: 0, can_send: false, chats_left_today: null, cap_reached: false, trial_ends_at: null });
  });

  for (const plan of ["pro", "max", "ultra"] as const) {
    it(`${plan}: slots and level from the config, no counter, and the hidden cap is not in the payload`, async () => {
      const u = await makeUser(`ent-${plan}`);
      await setSub(u.id, plan, "active", DAY);
      const e = await rpc<Ent>(u, "get_entitlement");
      expect(e).toMatchObject({ plan, slot_limit: PLAN_CONFIG.tiers[plan].slots, max_level: PLAN_CONFIG.tiers[plan].maxLevel, can_send: true, chats_left_today: null, cap_reached: false, trial_ends_at: null });
      expect(JSON.stringify(e)).not.toContain(String(HIDDEN_DAILY_CAPS[plan]));
    });
  }

  it("get_my_state carries the same entitlement in the one boot call", async () => {
    const u = await makeUser("ent-state");
    await setSub(u.id, "max", "active", DAY);
    const state = await rpc<{ entitlement: Ent }>(u, "get_my_state");
    expect(state.entitlement.plan).toBe("max");
  });
});

describe("subscriptions: RLS and grants", () => {
  it("a user can read their own subscription and never another user's", async () => {
    await setSub(a.id, "pro", "active", DAY);
    await setSub(b.id, "max", "active", DAY);
    const own = await a.client.from("subscriptions").select("user_id,plan");
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ user_id: a.id, plan: "pro" }]);
    const other = await a.client.from("subscriptions").select("*").eq("user_id", b.id);
    expect(other.data ?? []).toHaveLength(0);
  });

  it("no direct INSERT, UPDATE or DELETE for authenticated or anon", async () => {
    const row = { user_id: a.id, plan: "ultra", status: "active", expires_at: "2099-01-01T00:00:00Z" };
    const ins = await a.client.from("subscriptions").insert(row);
    expect(ins.error?.code).toBe("42501");
    const upd = await a.client.from("subscriptions").update({ plan: "ultra" }).eq("user_id", a.id);
    expect(upd.error?.code).toBe("42501");
    const del = await a.client.from("subscriptions").delete().eq("user_id", a.id);
    expect(del.error?.code).toBe("42501");
    const anon = createClient(URL, PUBLISHABLE, noPersist);
    expect((await anon.from("subscriptions").insert(row)).error).not.toBeNull();
    expect((await anon.from("subscriptions").select("*")).data ?? []).toHaveLength(0);
    expect(await effectivePlan(a.id)).toBe("pro"); // unchanged
  });

  it("authenticated cannot call set_subscription, effective_plan or reply_gate", async () => {
    const attempts: [string, Record<string, unknown>][] = [
      ["set_subscription", { p_user_id: a.id, p_plan: "ultra", p_status: "active", p_expires_at: "2099-01-01T00:00:00Z", p_purchase_token: "x", p_product_id: "ally_ultra" }],
      ["effective_plan", { p_user_id: b.id }],
      ["reply_gate", { p_companion_id: "c_x" }],
    ];
    for (const [fn, args] of attempts) {
      const { error } = await a.client.rpc(fn, args);
      expect(error?.code, fn).toBe("42501");
      const anon = await createClient(URL, PUBLISHABLE, noPersist).rpc(fn, args);
      expect(anon.error, `${fn} (anon)`).not.toBeNull();
    }
    expect(await effectivePlan(a.id)).toBe("pro");
  });

  it("set_subscription validates its input, and one purchase token cannot belong to two users", async () => {
    const bad = [
      { p_plan: "gold", p_status: "active" },
      { p_plan: "pro", p_status: "paused" },
      { p_plan: "pro", p_status: "active", p_expires_at: null },
    ];
    for (const extra of bad) {
      const { error } = await service.rpc("set_subscription", { p_user_id: a.id, p_expires_at: "2099-01-01T00:00:00Z", p_purchase_token: "t", p_product_id: "p", ...extra });
      expect(error?.code, JSON.stringify(extra)).toBe("22023");
    }
    const dup = await service.rpc("set_subscription", { p_user_id: b.id, p_plan: "pro", p_status: "active", p_expires_at: "2099-01-01T00:00:00Z", p_purchase_token: `tok-${a.id}`, p_product_id: "ally_pro" });
    expect(dup.error?.code).toBe("23505");
  });

  it("a non-admin cannot call admin_set_plan, and nothing changes", async () => {
    const { error } = await a.client.rpc("admin_set_plan", { p_user_id: a.id, p_plan_or_state: "ultra" });
    expect(error?.code).toBe("42501");
    expect(error?.message).toBe("not_admin");
    expect(await effectivePlan(a.id)).toBe("pro");
  });

  it("a subscription goes with its deleted user", async () => {
    const u = await makeUser("gone");
    await setSub(u.id, "pro", "active", DAY);
    await service.auth.admin.deleteUser(u.id);
    const { count } = await service.from("subscriptions").select("*", { count: "exact", head: true }).eq("user_id", u.id);
    expect(count).toBe(0);
  });
});

describe("trust level clamp", () => {
  type CompanionJson = { id: string; trustLevel: number; deeperLevelAvailable: boolean; deeperShown: boolean };
  const view = async (u: TestUser, id: string) => (await rpc<{ companions: CompanionJson[] }>(u, "get_my_state")).companions.find((c) => c.id === id)!;

  it("holds a non-Ultra user at level 5 without losing the stored progress, and Ultra lifts it at once", async () => {
    const u = await makeUser("clamp");
    await setSub(u.id, "pro", "active", DAY);
    const c = await create(u, "F01");
    await service.from("companions").update({ trust_level: 6, highest_level: 6, trust_points: 210 }).eq("id", c.id);

    const held = await view(u, c.id);
    expect(held).toMatchObject({ trustLevel: PLAN_CONFIG.defaultMaxLevel, deeperLevelAvailable: true, deeperShown: false });
    const { data: stored } = await service.from("companions").select("trust_level,trust_points").eq("id", c.id).single();
    expect(stored).toEqual({ trust_level: 6, trust_points: 210 }); // nothing lost

    await setSub(u.id, "ultra", "active", DAY);
    expect(await view(u, c.id)).toMatchObject({ trustLevel: 6, deeperLevelAvailable: false });
    await setSub(u.id, "max", "active", DAY); // a downgrade clamps again, still nothing lost
    expect(await view(u, c.id)).toMatchObject({ trustLevel: 5, deeperLevelAvailable: true });
  });

  it("a user below level 5 sees their real level and no flag", async () => {
    const u = await makeUser("below");
    const c = await create(u, "F01");
    await service.from("companions").update({ trust_level: 3 }).eq("id", c.id);
    expect(await view(u, c.id)).toMatchObject({ trustLevel: 3, deeperLevelAvailable: false });
  });

  it("mark_deeper_shown sets the once-per-companion flag, for the owner only", async () => {
    const u = await makeUser("shown");
    const c = await create(u, "F01");
    await rpc(u, "mark_deeper_shown", { companion_id: c.id });
    expect((await view(u, c.id)).deeperShown).toBe(true);
    const { error } = await b.client.rpc("mark_deeper_shown", { companion_id: c.id });
    expect(error?.code).toBe("P0002");
  });

  it("reply_gate (service role) reports the owner's ceiling and whether the companion is paused", async () => {
    const u = await makeUser("gate");
    await setSub(u.id, "max", "active", DAY);
    const first = await create(u, "F01");
    const second = await create(u, "M01");
    const open = await service.rpc("reply_gate", { p_companion_id: first.id });
    expect(open.data).toEqual({ max_level: 5, locked: false });
    await setSub(u.id, "pro", "active", DAY);
    expect((await service.rpc("reply_gate", { p_companion_id: second.id })).data).toEqual({ max_level: 5, locked: true });
    await setSub(u.id, "ultra", "active", DAY);
    expect((await service.rpc("reply_gate", { p_companion_id: second.id })).data).toEqual({ max_level: 6, locked: false });
  });
});

describe("downgrade lock", () => {
  it("keeps the first N companions by creation active and pauses the rest, then unpauses on upgrade", async () => {
    const u = await makeUser("downgrade");
    await setSub(u.id, "ultra", "active", DAY);
    const ids: string[] = [];
    for (const t of ["F01", "F02", "M01", "M02"]) ids.push((await create(u, t)).id);
    await setSub(u.id, "max", "active", DAY);
    const locked = async () => {
      const out: boolean[] = [];
      for (const id of ids) out.push(((await service.rpc("reply_gate", { p_companion_id: id })).data as { locked: boolean }).locked);
      return out;
    };
    expect(await locked()).toEqual([false, false, true, true]);
    await setSub(u.id, "pro", "active", DAY);
    expect(await locked()).toEqual([false, true, true, true]);
    await setTrialStart(u.id, 30 * DAY);
    await setSub(u.id, "pro", "expired", DAY);
    expect(await locked()).toEqual([true, true, true, true]); // expired: all read-only
    await setSub(u.id, "ultra", "active", DAY);
    expect(await locked()).toEqual([false, false, false, false]);
  });
});
