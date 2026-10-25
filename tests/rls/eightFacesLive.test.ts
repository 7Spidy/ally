import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// B5: eight faces live for QA (supabase/migrations/20261026000001_eight_faces_live.sql),
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
  const email = `rlsb5+${label}-${randomUUID()}@example.com`;
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
const coreOf = (primary: string) => ({ primary, secondary: null, weight: 100, ranked: [{ id: primary, score: 9 }] });

async function rpc<T = Record<string, unknown>>(u: TestUser, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await u.client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
}

interface CompanionJson {
  id: string;
  templateId: string;
  status: string;
  live: boolean;
  core: { primary: string; secondary: string | null; weight: number; ranked: unknown[] };
}

const addCompanion = (u: TestUser, templateId: string) => rpc<CompanionJson>(u, "qa_add_companion", { template_id: templateId });
const createCompanion = (u: TestUser, templateId: string, primary: string) =>
  rpc<CompanionJson>(u, "create_companion", { template_id: templateId, deck_gender: "woman", answers: ANSWERS, core: coreOf(primary), display_name: "" });

/** template, primary, secondary: mirrors src/lib/coreMap.ts for the eight. */
const EIGHT: [string, string, string | null][] = [
  ["F03", "ROMANTIC", "TRAINER"],
  ["F04", "PSYCH", null],
  ["F05", "ROMANTIC", "FRIEND"],
  ["F07", "PSYCH", null],
  ["F08", "TRAINER", null],
  ["F09", "FRIEND", null],
  ["F11", "MONEY", null],
  ["F13", "MONEY", "FRIEND"],
];

let qa: TestUser;

beforeAll(async () => {
  qa = await makeUser("qa", "qa");
});

afterAll(async () => {
  for (const id of createdIds) await service.auth.admin.deleteUser(id);
});

describe("qa_add_companion for the eight", () => {
  for (const [id, primary, secondary] of EIGHT) {
    it(`${id}: live with the ${primary} core`, async () => {
      const c = await addCompanion(qa, id);
      expect(c.templateId).toBe(id);
      expect(c.live).toBe(true);
      expect(c.core).toEqual({ primary, secondary, weight: secondary ? 70 : 100, ranked: [] });
    });
  }

  it("M01 and F06 raise template_not_testable", async () => {
    for (const t of ["M01", "F06"]) {
      const { error } = await qa.client.rpc("qa_add_companion", { template_id: t });
      expect(error?.message, t).toContain("template_not_testable");
    }
  });
});

describe("is_live by owner and core", () => {
  it("a normal user's F04 with a PSYCH primary is not live", async () => {
    const u = await makeUser("normal-f04");
    const c = await createCompanion(u, "F04", "PSYCH");
    expect(c.live).toBe(false);
  });

  it("a qa user's F03 with a TRAINER primary is not live (secondary-core deck)", async () => {
    const u = await makeUser("qa-f03-trainer", "qa");
    const c = await createCompanion(u, "F03", "TRAINER");
    expect(c.live).toBe(false);
  });

  it("a qa user's F03 with its own ROMANTIC primary is live", async () => {
    const u = await makeUser("qa-f03-romantic", "qa");
    const c = await createCompanion(u, "F03", "ROMANTIC");
    expect(c.live).toBe(true);
  });
});
