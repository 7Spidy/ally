import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// B4: Noor (F02) live for QA, and qa_add_companion
// (supabase/migrations/20261025000001_noor_live.sql), against the local
// Supabase stack (`npm run db:start`, `npm run e2e:env`).
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
  const email = `rlsb4+${label}-${randomUUID()}@example.com`;
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

interface CompanionJson {
  id: string;
  templateId: string;
  deckGender: string;
  status: string;
  live: boolean;
  core: { primary: string; secondary: string; weight: number; ranked: unknown[] };
}

const addCompanion = (u: TestUser, templateId: string) => rpc<CompanionJson>(u, "qa_add_companion", { template_id: templateId });
const createCompanion = (u: TestUser, templateId: string) =>
  rpc<CompanionJson>(u, "create_companion", { template_id: templateId, deck_gender: "woman", answers: ANSWERS, core: ROMANTIC, display_name: "" });

let normal: TestUser;
let qa: TestUser;
let adm: TestUser;

beforeAll(async () => {
  normal = await makeUser("normal");
  qa = await makeUser("qa", "qa");
  adm = await makeUser("adm", "admin");
});

afterAll(async () => {
  for (const id of createdIds) await service.auth.admin.deleteUser(id);
});

describe("qa_add_companion", () => {
  it("is refused for a normal user (42501)", async () => {
    const { error } = await normal.client.rpc("qa_add_companion", { template_id: "F02" });
    expect(error?.code).toBe("42501");
  });

  it("is refused to anon", async () => {
    const anon = createClient(URL, PUBLISHABLE, noPersist);
    const { error } = await anon.rpc("qa_add_companion", { template_id: "F02" });
    expect(error).not.toBeNull();
  });

  it("works for qa and admin, with the F02 romantic/psych core at weight 70", async () => {
    for (const u of [qa, adm]) {
      const c = await addCompanion(u, "F02");
      expect(c.templateId).toBe("F02");
      expect(c.status).toBe("active");
      expect(c.deckGender).toBe("woman");
      expect(c.core).toEqual({ primary: "ROMANTIC", secondary: "PSYCH", weight: 70, ranked: [] });
      expect(c.live).toBe(true);
    }
  });

  it("is idempotent: a second call returns the same active companion", async () => {
    const a = await addCompanion(qa, "F02");
    const b = await addCompanion(qa, "F02");
    expect(b.id).toBe(a.id);
    const { data } = await service.from("companions").select("id").eq("user_id", qa.id).eq("template_id", "F02").eq("status", "active");
    expect(data).toHaveLength(1);
  });

  it("uses ROMANTIC/MONEY for F01", async () => {
    const u = await makeUser("qa-f01", "qa");
    const c = await addCompanion(u, "F01");
    expect(c.core).toEqual({ primary: "ROMANTIC", secondary: "MONEY", weight: 70, ranked: [] });
  });

  it("bypasses a full slot ledger and the companion cap", async () => {
    const u = await makeUser("qa-cap", "qa");
    // One free slot, filled by a normal create; a normal second create is refused.
    await createCompanion(u, "F01");
    await expect(createCompanion(u, "F03")).rejects.toThrow(/slots_full/);
    const c = await addCompanion(u, "F02");
    expect(c.status).toBe("active");
    const { data: ledger } = await service.from("ledgers").select("slots_unlocked").eq("user_id", u.id).single();
    expect(ledger?.slots_unlocked).toBe(1);
    const { data: active } = await service.from("companions").select("id").eq("user_id", u.id).eq("status", "active");
    expect(active!.length).toBeGreaterThan(1);
  });

  it("restores a parted F02 by clearing the ledger_parted row", async () => {
    const u = await makeUser("qa-parted", "qa");
    const first = await addCompanion(u, "F02");
    await rpc(u, "part_companion", { companion_id: first.id });
    const { data: before } = await service.from("ledger_parted").select("template_id").eq("user_id", u.id);
    expect(before?.map((r) => r.template_id)).toContain("F02");
    const again = await addCompanion(u, "F02");
    expect(again.id).not.toBe(first.id);
    expect(again.status).toBe("active");
    const { data: after } = await service.from("ledger_parted").select("template_id").eq("user_id", u.id);
    expect(after?.map((r) => r.template_id)).not.toContain("F02");
  });

  it("rejects M01 and unknown templates (template_not_testable)", async () => {
    for (const t of ["M01", "F03", "", "F02; drop table companions"]) {
      const { error } = await qa.client.rpc("qa_add_companion", { template_id: t });
      expect(error?.message, t).toContain("template_not_testable");
    }
  });
});

describe("is_live", () => {
  it("is true for a qa-owned F02 and false for a normal-owned F02", async () => {
    const q = await addCompanion(qa, "F02");
    expect(q.live).toBe(true);
    // A normal user can own an F02 through the usual create path.
    const n = await createCompanion(normal, "F02");
    expect(n.live).toBe(false);
  });

  it("F01 is live for a normal user", async () => {
    const u = await makeUser("normal-f01");
    const c = await createCompanion(u, "F01");
    expect(c.live).toBe(true);
  });

  it("follows the owner's role: demoting a qa owner turns their F02 off", async () => {
    const u = await makeUser("qa-demote", "qa");
    const c = await addCompanion(u, "F02");
    expect(c.live).toBe(true);
    await service.from("profiles").update({ role: "user" }).eq("id", u.id);
    const state = await rpc<{ companions: CompanionJson[] }>(u, "get_my_state");
    expect(state.companions.find((x) => x.id === c.id)?.live).toBe(false);
  });
});

describe("mocked path for a normal user's F02", () => {
  it("receive_reply and seed_opener still work (not live_companion)", async () => {
    const u = await makeUser("normal-mock");
    const c = await createCompanion(u, "F02");
    const opener = await rpc<{ message: { text: string } | null }>(u, "seed_opener", { companion_id: c.id, body: "hi there" });
    expect(opener.message?.text).toBe("hi there");
    const reply = await rpc<{ message: { text: string } }>(u, "receive_reply", { companion_id: c.id, body: "hello" });
    expect(reply.message.text).toBe("hello");
  });

  it("a qa-owned F02 is refused on the mocked path (live_companion)", async () => {
    const c = await addCompanion(qa, "F02");
    const { error } = await qa.client.rpc("receive_reply", { companion_id: c.id, body: "hi" });
    expect(error?.message).toContain("live_companion");
  });
});
