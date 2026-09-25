import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { FREE_DAILY, MAX_COMPANIONS, PASS_CAP, PASS_HOURS } from "@/lib/config";

// P3 admin console (supabase/migrations/20260925000001_admin_console.sql),
// against the local Supabase stack (`npm run db:start`, `npm run e2e:env`).
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
const SECRET = process.env.SUPABASE_SECRET_KEY as string;
const CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(URL, SECRET, noPersist);
const createdIds: string[] = [];
const RUN = randomUUID().slice(0, 8);

interface TestUser {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(URL, PUBLISHABLE, noPersist);
  const { error } = await client.auth.signInWithPassword({ email, password, options: { captchaToken: CAPTCHA } });
  if (error) throw error;
  return client;
}

async function makeUser(label: string): Promise<TestUser> {
  const email = `rls3+${label}-${RUN}-${randomUUID().slice(0, 6)}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  createdIds.push(data.user.id);
  return { id: data.user.id, email, password, client: await signIn(email, password) };
}

async function makeAdmin(label: string): Promise<TestUser> {
  const u = await makeUser(label);
  const { error } = await service.from("profiles").update({ role: "admin" }).eq("id", u.id);
  if (error) throw error;
  return u;
}

async function rpc<T = Record<string, unknown>>(u: TestUser, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await u.client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
}

const ANSWERS = { q5: 0.4, q6: 0.5, q7: 0.5, q8: 0.38, q9: 0.5, q10: "head", q11: ["music"] };
const CORE = { primary: "MEHER", secondary: null, weight: 100, ranked: [{ id: "MEHER", score: 0.9 }] };

function createArgs(templateId: string) {
  return { template_id: templateId, deck_gender: templateId.startsWith("F") ? "woman" : "man", answers: ANSWERS, core: CORE, display_name: "" };
}

async function auditRows(target: string) {
  const { data, error } = await service.from("admin_audit").select("*").eq("target_user_id", target).order("id");
  if (error) throw error;
  return data as { actor_id: string; action: string; old_value: Record<string, unknown> | null; new_value: Record<string, unknown> | null }[];
}

async function ledgerRow(uid: string) {
  const { data, error } = await service.from("ledgers").select("*").eq("user_id", uid).maybeSingle();
  if (error) throw error;
  return data as { free_used: number; slots_unlocked: number; pass_used: number | null; pass_started_at: string | null; pass_ends_at: string | null } | null;
}

const ADMIN_RPCS: [string, (target: string) => Record<string, unknown>][] = [
  ["admin_list_users", () => ({})],
  ["admin_get_user", (t) => ({ target: t })],
  ["admin_set_status", (t) => ({ target: t, status: "suspended" })],
  ["admin_set_slots", (t) => ({ target: t, slots: 3 })],
  ["admin_set_free_daily_override", (t) => ({ target: t, value: 999 })],
  ["admin_set_pass_cap_override", (t) => ({ target: t, value: 999 })],
  ["admin_grant_pass", (t) => ({ target: t })],
  ["admin_end_pass", (t) => ({ target: t })],
];

let admin: TestUser;
let plain: TestUser;
let target: TestUser;
let targetCompanion: string;

beforeAll(async () => {
  expect(URL, "run `npm run e2e:env` first").toBeTruthy();
  admin = await makeAdmin("admin");
  plain = await makeUser("plain");
  target = await makeUser("target");
  targetCompanion = (await rpc<{ id: string }>(target, "create_companion", createArgs("F01"))).id;
  await rpc(target, "send_message", { companion_id: targetCompanion, body: "a private thought" });
});

afterAll(async () => {
  for (const id of createdIds) await service.from("admin_audit").delete().eq("actor_id", id);
  for (const id of createdIds) await service.auth.admin.deleteUser(id);
});

describe("access: only admins reach the admin RPCs and tables", () => {
  for (const [fn, args] of ADMIN_RPCS) {
    it(`${fn}: a non-admin gets 42501 and nothing changes`, async () => {
      const { error } = await plain.client.rpc(fn, args(target.id));
      expect(error?.code).toBe("42501");
      expect(error?.message).toBe("not_admin");
    });

    it(`${fn}: a client with no session is refused`, async () => {
      const anon = createClient(URL, PUBLISHABLE, noPersist);
      const { error } = await anon.rpc(fn, args(target.id));
      expect(error).not.toBeNull();
    });
  }

  it("the non-admin attempts above changed nothing on the target", async () => {
    const { data } = await service.from("profiles").select("status").eq("id", target.id).single();
    expect(data?.status).toBe("active");
    expect(await auditRows(target.id)).toHaveLength(0);
    const { count } = await service.from("user_limits").select("*", { count: "exact", head: true }).eq("user_id", target.id);
    expect(count).toBe(0);
  });

  it("admin_revoke_sessions is not executable by any signed-in user, admin included", async () => {
    for (const u of [plain, admin]) {
      const { error } = await u.client.rpc("admin_revoke_sessions", { actor: admin.id, target: target.id });
      expect(error, u === admin ? "admin" : "plain").not.toBeNull();
    }
  });

  it("a non-admin can't read user_limits or admin_audit, not even rows about themselves", async () => {
    await rpc(admin, "admin_set_free_daily_override", { target: plain.id, value: 50 });
    await rpc(admin, "admin_set_slots", { target: plain.id, slots: 2 });
    for (const table of ["user_limits", "admin_audit"]) {
      const own = await plain.client.from(table).select("*");
      expect(own.error, table).toBeNull();
      expect(own.data, table).toEqual([]);
    }
    // They exist: the admin sees them.
    const limits = await admin.client.from("user_limits").select("*").eq("user_id", plain.id);
    expect(limits.data).toHaveLength(1);
    const audit = await admin.client.from("admin_audit").select("*").eq("target_user_id", plain.id);
    expect(audit.data!.length).toBeGreaterThanOrEqual(2);
  });

  it("nobody, admins included, can write user_limits or admin_audit directly", async () => {
    for (const u of [plain, admin]) {
      const ins1 = await u.client.from("user_limits").insert({ user_id: u.id, free_daily_override: 100000 });
      expect(ins1.error?.code).toBe("42501");
      const ins2 = await u.client.from("admin_audit").insert({ actor_id: u.id, target_user_id: u.id, action: "suspend" });
      expect(ins2.error?.code).toBe("42501");
      const upd1 = await u.client.from("user_limits").update({ free_daily_override: 100000 }).eq("user_id", plain.id);
      expect(upd1.error?.code).toBe("42501");
      const upd2 = await u.client.from("admin_audit").update({ action: "unsuspend" }).eq("target_user_id", plain.id);
      expect(upd2.error?.code).toBe("42501");
      const del1 = await u.client.from("user_limits").delete().eq("user_id", plain.id);
      expect(del1.error?.code).toBe("42501");
      const del2 = await u.client.from("admin_audit").delete().eq("target_user_id", plain.id);
      expect(del2.error?.code).toBe("42501");
    }
    const { data } = await service.from("user_limits").select("free_daily_override").eq("user_id", plain.id).single();
    expect(data?.free_daily_override).toBe(50);
  });

  it("a non-admin can't make themselves admin", async () => {
    const { error } = await plain.client.from("profiles").update({ role: "admin" }).eq("id", plain.id);
    expect(error?.code).toBe("42501");
  });
});

describe("admin_list_users and admin_get_user", () => {
  let batch: TestUser[];

  beforeAll(async () => {
    batch = [];
    for (let i = 0; i < 3; i++) batch.push(await makeUser(`page${i}`));
  });

  it("searches email case-insensitively and keyset-paginates newest first", async () => {
    type Page = { users: { id: string; email: string }[]; next_cursor: { created_at: string; id: string } | null };
    // Upper case against a lower-case email: still one exact match.
    const first = await rpc<Page>(admin, "admin_list_users", { search: `PAGE0-${RUN.toUpperCase()}`, limit_n: 5 });
    expect(first.users.map((u) => u.id)).toEqual([batch[0].id]);

    const all: string[] = [];
    let cursor: Page["next_cursor"] = null;
    let pages = 0;
    do {
      const page: Page = await rpc<Page>(admin, "admin_list_users", {
        search: `-${RUN}-`,
        cursor_created_at: cursor?.created_at ?? null,
        cursor_id: cursor?.id ?? null,
        limit_n: 2,
      });
      expect(page.users.length).toBeLessThanOrEqual(2);
      all.push(...page.users.map((u) => u.id));
      cursor = page.next_cursor;
      pages++;
    } while (cursor && pages < 10);
    // Every user of this run (and only those), each exactly once, newest first.
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([admin, plain, target, ...batch].map((u) => u.id).sort());
    expect(all.indexOf(batch[2].id)).toBeLessThan(all.indexOf(batch[0].id));
    expect(pages).toBe(3);
  });

  it("list rows carry the metadata the console shows", async () => {
    const { users } = await rpc<{ users: Record<string, unknown>[] }>(admin, "admin_list_users", { search: target.email });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      id: target.id,
      email: target.email,
      is_anonymous: false,
      status: "active",
      role: "user",
      companion_count: 1,
      message_count: 1,
      ledger: { slots_unlocked: 1, free_used: 1, free_daily: FREE_DAILY, free_left: FREE_DAILY - 1, pass_active: false, pass_cap: PASS_CAP },
    });
    expect(typeof users[0].created_at).toBe("string");
    expect(typeof users[0].last_sign_in_at).toBe("string");
  });

  it("admin_get_user returns companions and counts but never message text", async () => {
    const detail = await rpc<Record<string, unknown>>(admin, "admin_get_user", { target: target.id });
    expect(detail.companions).toEqual([
      expect.objectContaining({ id: targetCompanion, template_id: "F01", status: "active", exchanges: 1, message_count: 1 }),
    ]);
    expect(detail.defaults).toEqual({ free_daily: FREE_DAILY, pass_cap: PASS_CAP, pass_hours: PASS_HOURS, max_companions: MAX_COMPANIONS });
    expect(JSON.stringify(detail)).not.toContain("a private thought");
  });

  it("admin_get_user on an unknown id is P0002", async () => {
    const { error } = await admin.client.rpc("admin_get_user", { target: randomUUID() });
    expect(error?.code).toBe("P0002");
  });
});

describe("admin writes are applied and audited", () => {
  it("admin_set_status suspends and unsuspends, logging each direction; a repeat is a no-op", async () => {
    const u = await makeUser("status");
    expect(await rpc(admin, "admin_set_status", { target: u.id, status: "suspended" })).toEqual({ changed: true, status: "suspended" });
    expect(await rpc(admin, "admin_set_status", { target: u.id, status: "suspended" })).toEqual({ changed: false, status: "suspended" });
    await rpc(admin, "admin_set_status", { target: u.id, status: "active" });
    const rows = await auditRows(u.id);
    expect(rows.map((r) => [r.action, r.actor_id, r.old_value, r.new_value])).toEqual([
      ["suspend", admin.id, { status: "active" }, { status: "suspended" }],
      ["unsuspend", admin.id, { status: "suspended" }, { status: "active" }],
    ]);
    const { error } = await admin.client.rpc("admin_set_status", { target: u.id, status: "banned" });
    expect(error?.code).toBe("22023");
  });

  it("an admin can't suspend themselves", async () => {
    const { error } = await admin.client.rpc("admin_set_status", { target: admin.id, status: "suspended" });
    expect(error?.message).toBe("cannot_suspend_self");
  });

  it("admin_set_slots creates the ledger if absent, validates the range and logs old/new", async () => {
    const u = await makeUser("slots");
    expect(await ledgerRow(u.id)).toBeNull();
    await rpc(admin, "admin_set_slots", { target: u.id, slots: 3 });
    expect((await ledgerRow(u.id))?.slots_unlocked).toBe(3);
    for (const bad of [0, MAX_COMPANIONS + 1]) {
      const { error } = await admin.client.rpc("admin_set_slots", { target: u.id, slots: bad });
      expect(error?.code, String(bad)).toBe("22023");
    }
    expect((await auditRows(u.id)).map((r) => [r.action, r.old_value, r.new_value])).toEqual([
      ["set_slots", { slots_unlocked: 1 }, { slots_unlocked: 3 }],
    ]);
    // The user can now actually hold three companions.
    for (const t of ["F02", "F03", "F04"]) await rpc(u, "create_companion", createArgs(t));
  });

  it("admin_grant_pass starts a default-length pass with an amount-0 ledger_passes row; admin_end_pass ends it", async () => {
    const u = await makeUser("pass");
    const noPass = await rpc<{ changed: boolean }>(admin, "admin_end_pass", { target: u.id });
    expect(noPass.changed).toBe(false);

    await rpc(admin, "admin_grant_pass", { target: u.id });
    const row = await ledgerRow(u.id);
    expect(row?.pass_used).toBe(0);
    expect(Date.parse(row!.pass_ends_at!) - Date.parse(row!.pass_started_at!)).toBe(PASS_HOURS * 3600000);
    const { data: passes } = await service.from("ledger_passes").select("amount").eq("user_id", u.id);
    expect(passes).toEqual([{ amount: 0 }]);

    // The user's own view of the ledger reflects it.
    const state = await rpc<{ ledger: { pass: { used: number; endsAt: number } | null } }>(u, "get_my_state");
    expect(state.ledger.pass?.used).toBe(0);
    expect(state.ledger.pass!.endsAt).toBeGreaterThan(Date.now());

    const ended = await rpc<{ changed: boolean; ledger: { pass_active: boolean } }>(admin, "admin_end_pass", { target: u.id });
    expect(ended).toMatchObject({ changed: true, ledger: { pass_active: false } });
    const after = await rpc<{ ledger: { pass: { endsAt: number } } }>(u, "get_my_state");
    expect(after.ledger.pass.endsAt).toBeLessThanOrEqual(Date.now());

    // One grant and one end logged; the no-op end before the grant was not.
    expect((await auditRows(u.id)).map((r) => r.action)).toEqual(["grant_pass", "end_pass"]);

    const { error } = await admin.client.rpc("admin_grant_pass", { target: u.id, hours: 0 });
    expect(error?.code).toBe("22023");
  });

  it("overrides upsert user_limits, a null clears one, and each change is logged", async () => {
    const u = await makeUser("limits");
    await rpc(admin, "admin_set_free_daily_override", { target: u.id, value: 7 });
    await rpc(admin, "admin_set_pass_cap_override", { target: u.id, value: 9 });
    let { data } = await service.from("user_limits").select("*").eq("user_id", u.id).single();
    expect(data).toMatchObject({ free_daily_override: 7, pass_cap_override: 9, updated_by: admin.id });
    await rpc(admin, "admin_set_free_daily_override", { target: u.id, value: null });
    ({ data } = await service.from("user_limits").select("*").eq("user_id", u.id).single());
    expect(data).toMatchObject({ free_daily_override: null, pass_cap_override: 9 });
    const { error } = await admin.client.rpc("admin_set_pass_cap_override", { target: u.id, value: -1 });
    expect(error?.code).toBe("22023");
    expect((await auditRows(u.id)).map((r) => [r.action, r.old_value, r.new_value])).toEqual([
      ["set_free_daily_override", { free_daily_override: null }, { free_daily_override: 7 }],
      ["set_pass_cap_override", { pass_cap_override: null }, { pass_cap_override: 9 }],
      ["set_free_daily_override", { free_daily_override: 7 }, { free_daily_override: null }],
    ]);
  });

  it("the audit trail and limits go with a deleted user", async () => {
    const u = await makeUser("gone");
    await rpc(admin, "admin_set_free_daily_override", { target: u.id, value: 3 });
    expect(await auditRows(u.id)).toHaveLength(1);
    await service.auth.admin.deleteUser(u.id);
    expect(await auditRows(u.id)).toHaveLength(0);
    const { count } = await service.from("user_limits").select("*", { count: "exact", head: true }).eq("user_id", u.id);
    expect(count).toBe(0);
  });
});

describe("suspension is enforced by the P2 RPCs", () => {
  it("a suspended user's send_message, create_companion, unlock_slot and buy_pass all fail; an active user's don't", async () => {
    const u = await makeUser("suspended");
    const c = await rpc<{ id: string }>(u, "create_companion", createArgs("M01"));
    await rpc(admin, "admin_set_status", { target: u.id, status: "suspended" });

    const before = await ledgerRow(u.id);
    const attempts: [string, Record<string, unknown> | undefined][] = [
      ["send_message", { companion_id: c.id, body: "blocked?" }],
      ["create_companion", createArgs("M02")],
      ["unlock_slot", { amount: 199 }],
      ["buy_pass", undefined],
    ];
    for (const [fn, args] of attempts) {
      const { error } = await u.client.rpc(fn, args);
      expect(error?.message, fn).toBe("account_suspended");
      expect(error?.code, fn).toBe("42501");
    }
    // Nothing was written.
    const { count: msgs } = await service.from("messages").select("*", { count: "exact", head: true }).eq("user_id", u.id);
    expect(msgs).toBe(0);
    const { count: comps } = await service.from("companions").select("*", { count: "exact", head: true }).eq("user_id", u.id);
    expect(comps).toBe(1);
    expect(await ledgerRow(u.id)).toEqual(before);

    // They can still load their state (read-only).
    const state = await rpc<{ companions: unknown[] }>(u, "get_my_state");
    expect(state.companions).toHaveLength(1);

    // Unsuspended, the same calls go through.
    await rpc(admin, "admin_set_status", { target: u.id, status: "active" });
    const sent = await rpc<{ blocked: boolean }>(u, "send_message", { companion_id: c.id, body: "back" });
    expect(sent.blocked).toBe(false);
    await rpc(u, "unlock_slot", { amount: 199 });
    await rpc(u, "create_companion", createArgs("M02"));
    await rpc(u, "buy_pass");
  });
});

describe("limit overrides change send_message's real behaviour", () => {
  it("a free_daily_override below the default blocks at the override, and clearing it restores the default", async () => {
    const u = await makeUser("freecap");
    const c = await rpc<{ id: string }>(u, "create_companion", createArgs("F05"));
    await rpc(admin, "admin_set_free_daily_override", { target: u.id, value: 2 });

    type Send = { blocked: boolean; status: string; ledger: { freeUsed: number; freeDaily: number } };
    const one = await rpc<Send>(u, "send_message", { companion_id: c.id, body: "1" });
    expect(one).toMatchObject({ blocked: false, ledger: { freeUsed: 1, freeDaily: 2 } });
    await rpc(u, "send_message", { companion_id: c.id, body: "2" });
    const three = await rpc<Send>(u, "send_message", { companion_id: c.id, body: "3" });
    expect(three).toMatchObject({ blocked: true, status: "empty" });
    expect((await ledgerRow(u.id))?.free_used).toBe(2);

    await rpc(admin, "admin_set_free_daily_override", { target: u.id, value: null });
    const again = await rpc<Send>(u, "send_message", { companion_id: c.id, body: "3 again" });
    expect(again).toMatchObject({ blocked: false, ledger: { freeUsed: 3, freeDaily: FREE_DAILY } });
  });

  it("a free_daily_override above the default lets a user past FREE_DAILY", async () => {
    const u = await makeUser("freeraise");
    const c = await rpc<{ id: string }>(u, "create_companion", createArgs("F06"));
    await service.from("ledgers").update({ free_used: FREE_DAILY }).eq("user_id", u.id);
    const capped = await rpc<{ blocked: boolean }>(u, "send_message", { companion_id: c.id, body: "no" });
    expect(capped.blocked).toBe(true);
    await rpc(admin, "admin_set_free_daily_override", { target: u.id, value: FREE_DAILY + 1 });
    const ok = await rpc<{ blocked: boolean; ledger: { freeUsed: number } }>(u, "send_message", { companion_id: c.id, body: "yes" });
    expect(ok).toMatchObject({ blocked: false, ledger: { freeUsed: FREE_DAILY + 1 } });
  });

  it("a pass_cap_override caps an active pass at the override", async () => {
    const u = await makeUser("passcap");
    const c = await rpc<{ id: string }>(u, "create_companion", createArgs("F07"));
    await rpc(admin, "admin_grant_pass", { target: u.id });
    await rpc(admin, "admin_set_pass_cap_override", { target: u.id, value: 1 });
    type Send = { blocked: boolean; status: string; ledger: { passCap: number; pass: { used: number } } };
    const first = await rpc<Send>(u, "send_message", { companion_id: c.id, body: "on pass" });
    expect(first).toMatchObject({ blocked: false, ledger: { passCap: 1, pass: { used: 1 } } });
    const second = await rpc<Send>(u, "send_message", { companion_id: c.id, body: "over" });
    expect(second).toMatchObject({ blocked: true, status: "capped" });
  });
});

describe("force logout (admin_revoke_sessions, service role)", () => {
  it("revokes every session of the target and logs it; a non-admin actor is refused", async () => {
    const u = await makeUser("logout");
    const second = await signIn(u.email, u.password);
    expect((await u.client.auth.getUser()).error).toBeNull();
    expect((await second.auth.getUser()).error).toBeNull();

    const refused = await service.rpc("admin_revoke_sessions", { actor: plain.id, target: u.id });
    expect(refused.error?.code).toBe("42501");
    expect((await second.auth.getUser()).error).toBeNull();

    const { data, error } = await service.rpc("admin_revoke_sessions", { actor: admin.id, target: u.id });
    expect(error).toBeNull();
    expect((data as { revoked: number }).revoked).toBeGreaterThanOrEqual(2);
    // getUser() is a server round trip, so a revoked session fails at once.
    expect((await u.client.auth.getUser()).error).not.toBeNull();
    expect((await second.auth.getUser()).error).not.toBeNull();
    expect((await auditRows(u.id)).map((r) => [r.action, r.actor_id])).toEqual([["force_logout", admin.id]]);
    // Other users' sessions are untouched.
    expect((await admin.client.auth.getUser()).error).toBeNull();
  });
});
