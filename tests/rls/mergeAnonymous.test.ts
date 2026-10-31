import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// v3.1 section 6.2: merge_anonymous (supabase/migrations/20261031000002_merge_anonymous.sql)
// and the display-name backstop (20261031000001_name_check.sql), against the local stack.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
const SECRET = process.env.SUPABASE_SECRET_KEY as string;
const CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SECRET, noPersist);
const createdIds: string[] = [];

interface TestUser {
  id: string;
  client: SupabaseClient;
}

async function makeUser(): Promise<TestUser> {
  const email = `merge+${randomUUID()}@example.com`;
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

const ANSWERS = { q5: 0, q6: 0, q7: 0, q8: 0, q9: 0, q10: "head", q11: ["music"], tb: null };
const CORE = { primary: "PSYCH", secondary: null, weight: 100, ranked: [{ id: "PSYCH", score: 9 }] };

async function unlock(u: TestUser, slots: number) {
  const { error } = await admin.from("ledgers").upsert({ user_id: u.id, day: "2026-01-01", slots_unlocked: slots });
  if (error) throw error;
}

async function createCompanion(u: TestUser, templateId: string): Promise<string> {
  const { data, error } = await u.client.rpc("create_companion", {
    template_id: templateId,
    deck_gender: "woman",
    answers: ANSWERS,
    core: CORE,
    display_name: "",
  });
  if (error) throw new Error(`create_companion: ${error.message}`);
  return (data as { id: string }).id;
}

async function addMessage(u: TestUser, companionId: string, text: string) {
  const { error } = await admin.from("messages").insert({ companion_id: companionId, user_id: u.id, who: "me", text });
  if (error) throw error;
}

afterAll(async () => {
  for (const id of createdIds) await admin.auth.admin.deleteUser(id);
});

describe("merge_anonymous", () => {
  it("moves companions and their messages to the target", async () => {
    const anon = await makeAnonymous();
    const target = await makeUser();
    const c = await createCompanion(anon, "F01");
    await addMessage(anon, c, "hello");

    const { data, error } = await admin.rpc("merge_anonymous", { p_anon: anon.id, p_target: target.id });
    expect(error).toBeNull();
    expect(data).toEqual({ moved: [c], skipped: [] });

    const owner = await admin.from("companions").select("user_id").eq("id", c).single();
    expect(owner.data?.user_id).toBe(target.id);
    const msgs = await admin.from("messages").select("user_id,text").eq("companion_id", c);
    expect(msgs.data).toEqual([{ user_id: target.id, text: "hello" }]);

    await admin.auth.admin.deleteUser(anon.id);
    const after = await admin.from("companions").select("id").eq("id", c);
    expect(after.data).toHaveLength(1);
    const own = await target.client.from("companions").select("id").eq("id", c);
    expect(own.data).toHaveLength(1);
  });

  it("skips a template the target already has", async () => {
    const anon = await makeAnonymous();
    const target = await makeUser();
    const mine = await createCompanion(target, "F01");
    const dup = await createCompanion(anon, "F01");

    const { data } = await admin.rpc("merge_anonymous", { p_anon: anon.id, p_target: target.id });
    expect(data).toEqual({ moved: [], skipped: [{ id: dup, reason: "duplicate" }] });
    const still = await admin.from("companions").select("user_id").eq("id", mine).single();
    expect(still.data?.user_id).toBe(target.id);
  });

  it("skips with reason full when the target is at the cap", async () => {
    const anon = await makeAnonymous();
    const target = await makeUser();
    await unlock(target, 3);
    await createCompanion(target, "F01");
    await createCompanion(target, "F02");
    await createCompanion(target, "F03");
    const extra = await createCompanion(anon, "F04");

    const { data } = await admin.rpc("merge_anonymous", { p_anon: anon.id, p_target: target.id });
    expect(data).toEqual({ moved: [], skipped: [{ id: extra, reason: "full" }] });
  });

  it("copies a valid display name only when the target has none", async () => {
    const anon = await makeAnonymous();
    const target = await makeUser();
    await anon.client.rpc("set_display_name", { p_name: "Rhea" });
    await admin.rpc("merge_anonymous", { p_anon: anon.id, p_target: target.id });
    const p = await admin.from("profiles").select("display_name").eq("id", target.id).single();
    expect(p.data?.display_name).toBe("Rhea");
  });

  it("is callable by service_role only", async () => {
    const anon = await makeAnonymous();
    const target = await makeUser();
    for (const u of [anon, target]) {
      const { error } = await u.client.rpc("merge_anonymous", { p_anon: anon.id, p_target: target.id });
      expect(error).not.toBeNull();
    }
    const unauth = createClient(URL, PUBLISHABLE, noPersist);
    const { error } = await unauth.rpc("merge_anonymous", { p_anon: anon.id, p_target: target.id });
    expect(error).not.toBeNull();
  });
});

describe("display name backstop", () => {
  it("set_display_name saves a valid name and rejects an invalid one", async () => {
    const u = await makeUser();
    const ok = await u.client.rpc("set_display_name", { p_name: "  Mary Ann " });
    expect(ok.data).toBe("Mary Ann");
    const bad = await u.client.rpc("set_display_name", { p_name: "R2D2" });
    expect(bad.error?.message).toContain("invalid_name");
  });

  it("create_companion skips an invalid name instead of raising", async () => {
    const u = await makeUser();
    const { error } = await u.client.rpc("create_companion", {
      template_id: "F01",
      deck_gender: "woman",
      answers: ANSWERS,
      core: CORE,
      display_name: "12345",
    });
    expect(error).toBeNull();
    const p = await admin.from("profiles").select("display_name").eq("id", u.id).single();
    expect(p.data?.display_name).toBeNull();
  });

  it("the check constraint rejects a direct write of a bad name", async () => {
    const u = await makeUser();
    const { error } = await u.client.from("profiles").update({ display_name: "x" }).eq("id", u.id);
    expect(error).not.toBeNull();
  });
});
