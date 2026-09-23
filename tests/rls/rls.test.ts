import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Runs against the local Supabase stack (`npm run db:start`, `npm run e2e:env`).
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
const SECRET = process.env.SUPABASE_SECRET_KEY as string;
const CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX"; // passes only against Cloudflare's test secret

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SECRET, noPersist);

const createdIds: string[] = [];

async function makeUser(label: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = `rls+${label}-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  createdIds.push(data.user.id);
  const client = createClient(URL, PUBLISHABLE, noPersist);
  const signIn = await client.auth.signInWithPassword({ email, password, options: { captchaToken: CAPTCHA } });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

async function makeAnonymous(): Promise<{ id: string; client: SupabaseClient }> {
  const client = createClient(URL, PUBLISHABLE, noPersist);
  const { data, error } = await client.auth.signInAnonymously({ options: { captchaToken: CAPTCHA } });
  if (error || !data.user) throw error ?? new Error("anonymous sign-in failed");
  createdIds.push(data.user.id);
  return { id: data.user.id, client };
}

let a: { id: string; client: SupabaseClient };
let b: { id: string; client: SupabaseClient };

beforeAll(async () => {
  expect(URL, "run `npm run e2e:env` first").toBeTruthy();
  a = await makeUser("a");
  b = await makeUser("b");
  const inserted = await admin.from("consents").insert({ user_id: b.id, version: "test", marketing: false });
  expect(inserted.error).toBeNull();
});

afterAll(async () => {
  for (const id of createdIds) await admin.auth.admin.deleteUser(id);
});

describe("profiles", () => {
  it("every new auth user gets a profile row", async () => {
    const { data } = await admin.from("profiles").select("id").eq("id", a.id);
    expect(data).toHaveLength(1);
  });

  it("A can read its own profile but not B's", async () => {
    const own = await a.client.from("profiles").select("id").eq("id", a.id);
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    const other = await a.client.from("profiles").select("id").eq("id", b.id);
    expect(other.data ?? []).toHaveLength(0);
  });

  it("A can update its own display_name", async () => {
    const { error } = await a.client.from("profiles").update({ display_name: "Alice" }).eq("id", a.id);
    expect(error).toBeNull();
    const { data } = await admin.from("profiles").select("display_name").eq("id", a.id).single();
    expect(data?.display_name).toBe("Alice");
  });

  it("A cannot update its own role or status", async () => {
    const role = await a.client.from("profiles").update({ role: "admin" }).eq("id", a.id);
    expect(role.error).not.toBeNull();
    const status = await a.client.from("profiles").update({ status: "suspended" }).eq("id", a.id);
    expect(status.error).not.toBeNull();
    const { data } = await admin.from("profiles").select("role,status").eq("id", a.id).single();
    expect(data).toEqual({ role: "user", status: "active" });
  });

  it("A cannot update B's display_name", async () => {
    await a.client.from("profiles").update({ display_name: "Hijacked" }).eq("id", b.id);
    const { data } = await admin.from("profiles").select("display_name").eq("id", b.id).single();
    expect(data?.display_name).not.toBe("Hijacked");
  });
});

describe("consents", () => {
  it("A can insert its own consent and read it back, but not B's", async () => {
    const ins = await a.client.from("consents").insert({ user_id: a.id, version: "test", marketing: true });
    expect(ins.error).toBeNull();
    const own = await a.client.from("consents").select("user_id").eq("user_id", a.id);
    expect(own.data?.length).toBeGreaterThanOrEqual(1);
    const other = await a.client.from("consents").select("user_id").eq("user_id", b.id);
    expect(other.data ?? []).toHaveLength(0);
  });

  it("A cannot insert a consent with user_id = B", async () => {
    const { error } = await a.client.from("consents").insert({ user_id: b.id, version: "forged", marketing: false });
    expect(error).not.toBeNull();
    const { data } = await admin.from("consents").select("version").eq("user_id", b.id).eq("version", "forged");
    expect(data).toHaveLength(0);
  });

  it("consents are append-only for users: no update, no delete", async () => {
    const upd = await a.client.from("consents").update({ marketing: false }).eq("user_id", a.id);
    expect(upd.error).not.toBeNull();
    const del = await a.client.from("consents").delete().eq("user_id", a.id);
    expect(del.error).not.toBeNull();
  });
});

describe("purge_self", () => {
  it("raises 42501 for a permanent user, and the user still exists", async () => {
    const { error } = await a.client.rpc("purge_self");
    expect(error?.code).toBe("42501");
    const { data } = await admin.auth.admin.getUserById(a.id);
    expect(data.user?.id).toBe(a.id);
  });

  it("deletes an anonymous user and cascades their rows", async () => {
    const anon = await makeAnonymous();
    const ins = await anon.client.from("consents").insert({ user_id: anon.id, version: "test", marketing: false });
    expect(ins.error).toBeNull();

    const { error } = await anon.client.rpc("purge_self");
    expect(error).toBeNull();

    const gone = await admin.auth.admin.getUserById(anon.id);
    expect(gone.data.user).toBeNull();
    const profile = await admin.from("profiles").select("id").eq("id", anon.id);
    expect(profile.data).toHaveLength(0);
    const consent = await admin.from("consents").select("id").eq("user_id", anon.id);
    expect(consent.data).toHaveLength(0);
  });

  it("is not callable without a session", async () => {
    const client = createClient(URL, PUBLISHABLE, noPersist);
    const { error } = await client.rpc("purge_self");
    expect(error).not.toBeNull();
  });
});

describe("no session", () => {
  it("an anonymous-key client with no session cannot read either table", async () => {
    const client = createClient(URL, PUBLISHABLE, noPersist);
    const profiles = await client.from("profiles").select("id");
    expect(profiles.data ?? []).toHaveLength(0);
    const consents = await client.from("consents").select("id");
    expect(consents.data ?? []).toHaveLength(0);
  });

  it("ping() is callable without a session (keep-alive target)", async () => {
    const client = createClient(URL, PUBLISHABLE, noPersist);
    const { data, error } = await client.rpc("ping");
    expect(error).toBeNull();
    expect(data).toBe(1);
  });
});
