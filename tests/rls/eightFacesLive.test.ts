import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

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
  deckGender: string;
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

  it("M99 and an injection string raise template_not_testable", async () => {
    for (const t of ["M99", "F03; drop table companions"]) {
      const { error } = await qa.client.rpc("qa_add_companion", { template_id: t });
      expect(error?.message, t).toContain("template_not_testable");
    }
  });
});

// B6: ten men live for QA (supabase/migrations/20261101000001_ten_men_live.sql).
const TEN: [string, string, string | null][] = [
  ["M01", "ROMANTIC", "MONEY"],
  ["M02", "ROMANTIC", "MONEY"],
  ["M03", "ROMANTIC", "FRIEND"],
  ["M04", "ROMANTIC", "PSYCH"],
  ["M05", "ROMANTIC", "MONEY"],
  ["M06", "MONEY", null],
  ["M07", "ROMANTIC", "FRIEND"],
  ["M08", "TRAINER", null],
  ["M09", "TRAINER", "PSYCH"],
  ["M10", "FRIEND", null],
];

describe("qa_add_companion for the ten men", () => {
  for (const [id, primary, secondary] of TEN) {
    it(`${id}: live with the ${primary} core and deckGender man`, async () => {
      const c = await addCompanion(qa, id);
      expect(c.templateId).toBe(id);
      expect(c.live).toBe(true);
      expect(c.deckGender).toBe("man");
      expect(c.core).toEqual({ primary, secondary, weight: secondary ? 70 : 100, ranked: [] });
    });
  }

  it("F03 still gets deckGender woman", async () => {
    expect((await addCompanion(qa, "F03")).deckGender).toBe("woman");
  });

  it("a normal user is rejected", async () => {
    const u = await makeUser("normal-m01");
    const { error } = await u.client.rpc("qa_add_companion", { template_id: "M01" });
    expect(error).toBeTruthy();
  });
});

// B7: the remaining twelve faces live (supabase/migrations/20261102000001_twelve_faces_live.sql).
const TWELVE: [string, string, string | null][] = [
  ["F06", "ROMANTIC", "TRAINER"],
  ["F10", "ROMANTIC", "TRAINER"],
  ["F12", "FRIEND", null],
  ["F14", "ROMANTIC", null],
  ["F15", "ROMANTIC", "PSYCH"],
  ["F16", "ROMANTIC", "MONEY"],
  ["M11", "PSYCH", null],
  ["M12", "ROMANTIC", "TRAINER"],
  ["M13", "PSYCH", null],
  ["M14", "ROMANTIC", null],
  ["M15", "FRIEND", "TRAINER"],
  ["M16", "ROMANTIC", null],
];

describe("qa_add_companion for the twelve", () => {
  for (const [id, primary, secondary] of TWELVE) {
    it(`${id}: live with the ${primary} core`, async () => {
      const c = await addCompanion(qa, id);
      expect(c.templateId).toBe(id);
      expect(c.live).toBe(true);
      expect(c.deckGender).toBe(id.startsWith("M") ? "man" : "woman");
      expect(c.core).toEqual({ primary, secondary, weight: secondary ? 70 : 100, ranked: [] });
    });
  }
});

// CORE_MAP in src/lib/coreMap.ts, all 32.
const CORE_MAP_ALL: Record<string, [string, string | null]> = {
  F01: ["ROMANTIC", "MONEY"], F02: ["ROMANTIC", "PSYCH"], F03: ["ROMANTIC", "TRAINER"], F04: ["PSYCH", null], F05: ["ROMANTIC", "FRIEND"],
  F06: ["ROMANTIC", "TRAINER"], F07: ["PSYCH", null], F08: ["TRAINER", null], F09: ["FRIEND", null], F10: ["ROMANTIC", "TRAINER"],
  F11: ["MONEY", null], F12: ["FRIEND", null], F13: ["MONEY", "FRIEND"], F14: ["ROMANTIC", null], F15: ["ROMANTIC", "PSYCH"], F16: ["ROMANTIC", "MONEY"],
  M01: ["ROMANTIC", "MONEY"], M02: ["ROMANTIC", "MONEY"], M03: ["ROMANTIC", "FRIEND"], M04: ["ROMANTIC", "PSYCH"], M05: ["ROMANTIC", "MONEY"],
  M06: ["MONEY", null], M07: ["ROMANTIC", "FRIEND"], M08: ["TRAINER", null], M09: ["TRAINER", "PSYCH"], M10: ["FRIEND", null],
  M11: ["PSYCH", null], M12: ["ROMANTIC", "TRAINER"], M13: ["PSYCH", null], M14: ["ROMANTIC", null], M15: ["FRIEND", "TRAINER"], M16: ["ROMANTIC", null],
};

/** Runs SQL as postgres inside the local Supabase db container (ally_private is not exposed over the API). */
function psql(sql: string): string {
  const id = /project_id\s*=\s*"([^"]+)"/.exec(readFileSync(path.resolve(__dirname, "../../supabase/config.toml"), "utf8"))?.[1];
  if (!id) throw new Error("project_id missing from supabase/config.toml");
  return execFileSync("docker", ["exec", "-i", `supabase_db_${id}`, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-F", "|"], { input: sql, encoding: "utf8" }).trim();
}

describe("live_faces()", () => {
  it("returns 32 rows, all with audience all, each matching CORE_MAP", () => {
    const rows = psql("select template_id, primary_core, coalesce(secondary_core, ''), audience from ally_private.live_faces() order by 1;")
      .split("\n")
      .map((l) => l.split("|"));
    expect(rows).toHaveLength(32);
    for (const [id, primary, secondary, audience] of rows) {
      expect(audience, id).toBe("all");
      expect([primary, secondary || null], id).toEqual(CORE_MAP_ALL[id]);
    }
    expect(rows.map((r) => r[0]).sort()).toEqual(Object.keys(CORE_MAP_ALL).sort());
  });
});

describe("is_live by owner and core", () => {
  it("a normal user's F04 with a PSYCH primary is live (audience all)", async () => {
    const u = await makeUser("normal-f04");
    const c = await createCompanion(u, "F04", "PSYCH");
    expect(c.live).toBe(true);
  });

  it("a normal user's F04 with a mismatched ROMANTIC primary is not live", async () => {
    const u = await makeUser("normal-f04-mismatch");
    const c = await createCompanion(u, "F04", "ROMANTIC");
    expect(c.live).toBe(false);
  });

  it("a normal user's F02 with ROMANTIC is live and with PSYCH is not", async () => {
    const u = await makeUser("normal-f02");
    expect((await createCompanion(u, "F02", "ROMANTIC")).live).toBe(true);
    // A user cannot hold the same template twice, so the PSYCH case is a second user.
    const other = await makeUser("normal-f02-psych");
    expect((await createCompanion(other, "F02", "PSYCH")).live).toBe(false);
  });

  it("a qa user's F03 with a TRAINER primary is not live (secondary-core mismatch)", async () => {
    const u = await makeUser("qa-f03-trainer", "qa");
    const c = await createCompanion(u, "F03", "TRAINER");
    expect(c.live).toBe(false);
  });

  it("a qa user's F03 with its own ROMANTIC primary is live", async () => {
    const u = await makeUser("qa-f03-romantic", "qa");
    const c = await createCompanion(u, "F03", "ROMANTIC");
    expect(c.live).toBe(true);
  });

  it("a normal user's new face is live when its primary matches, not otherwise", async () => {
    const u = await makeUser("normal-f06");
    expect((await createCompanion(u, "F06", "ROMANTIC")).live).toBe(true);
    await rpc(u, "unlock_slot", { amount: 199 });
    expect((await createCompanion(u, "F12", "ROMANTIC")).live).toBe(false);
  });
});

// The backfill is the `update public.companions ...;` statement in the migration, run verbatim.
const BACKFILL = (() => {
  const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261102000001_twelve_faces_live.sql"), "utf8");
  const m = /update public\.companions c[\s\S]*?;\s*$/m.exec(sql);
  if (!m) throw new Error("backfill statement not found in the migration");
  return m[0];
})();

describe("backfill of mismatched companions", () => {
  it("aligns an active mismatched companion to its face, keeps ranked, and leaves parted ones alone", async () => {
    const u = await makeUser("backfill");
    await rpc(u, "unlock_slot", { amount: 199 });
    const c = await createCompanion(u, "F11", "ROMANTIC"); // Money face, Romantic core: mismatched
    expect(c.live).toBe(false);
    const parted = await createCompanion(u, "M06", "ROMANTIC");
    await rpc(u, "part_companion", { companion_id: parted.id });
    const { data: partedBefore } = await service.from("companions").select("core").eq("id", parted.id).single();

    psql(BACKFILL);

    const state = await rpc<{ companions: CompanionJson[] }>(u, "get_my_state");
    const fixed = state.companions.find((x) => x.id === c.id)!;
    expect(fixed.live).toBe(true);
    expect(fixed.core).toEqual({ primary: "MONEY", secondary: null, weight: 100, ranked: c.core.ranked });
    const { data: partedAfter } = await service.from("companions").select("core").eq("id", parted.id).single();
    expect(partedAfter!.core).toEqual(partedBefore!.core);
  });

  it("sets the secondary and weight 70 for a face with a secondary core", async () => {
    const u = await makeUser("backfill-sec");
    const c = await createCompanion(u, "F13", "ROMANTIC"); // Money primary, Friend secondary
    psql(BACKFILL);
    const state = await rpc<{ companions: CompanionJson[] }>(u, "get_my_state");
    const fixed = state.companions.find((x) => x.id === c.id)!;
    expect(fixed.live).toBe(true);
    expect(fixed.core).toMatchObject({ primary: "MONEY", secondary: "FRIEND", weight: 70 });
  });
});
