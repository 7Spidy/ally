import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DECAY_POINTS, LEVELS } from "@/lib/trust";
import { HIDDEN_DAILY_CAPS, PART_PURGE_DAYS, PLAN_CONFIG } from "@/lib/config";

// The server-state RPCs hardcode the plan and ledger constants as
// `ally_private.<name>() ... select <n>` functions. This reads the latest
// definition of each from the migrations (honouring later `drop function`s) and
// fails if it no longer matches src/lib/config.ts, so neither side can change alone.
const MIGRATIONS = path.join(__dirname, "../../supabase/migrations");

function sqlConstants(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    // Definitions and drops in file order, so a later drop removes an earlier definition.
    const re = /create(?:\s+or\s+replace)?\s+function\s+ally_private\.(\w+)\(\)\s+returns\s+int\b[^$]*\$\$\s*select\s+(\d+)\s*\$\$|drop\s+function\s+ally_private\.(\w+)\(\)/gi;
    for (const m of sql.matchAll(re)) {
      if (m[3]) delete out[m[3]];
      else out[m[1]] = Number(m[2]); // later migrations win
    }
  }
  return out;
}

describe("SQL constants match src/lib/config.ts", () => {
  const sql = sqlConstants();
  const { tiers, trial } = PLAN_CONFIG;
  const expected: Record<string, number> = {
    free_daily: trial.dailyChats,
    trial_days: PLAN_CONFIG.trialDays,
    slots_trial: trial.slots,
    slots_pro: tiers.pro.slots,
    slots_max: tiers.max.slots,
    slots_ultra: tiers.ultra.slots,
    cap_pro: HIDDEN_DAILY_CAPS.pro,
    cap_max: HIDDEN_DAILY_CAPS.max,
    cap_ultra: HIDDEN_DAILY_CAPS.ultra,
    max_level_default: PLAN_CONFIG.defaultMaxLevel,
    max_level_ultra: tiers.ultra.maxLevel,
    price_pro: tiers.pro.price,
    price_max: tiers.max.price,
    price_ultra: tiers.ultra.price,
    part_purge_days: PART_PURGE_DAYS,
  };

  for (const [name, value] of Object.entries(expected)) {
    it(`ally_private.${name}() = ${value}`, () => {
      expect(sql[name], `ally_private.${name}() not found in supabase/migrations`).toBeDefined();
      expect(sql[name]).toBe(value);
    });
  }

  it("pins the current values, so a change on either side is deliberate", () => {
    expect(expected).toEqual({
      free_daily: 100,
      trial_days: 7,
      slots_trial: 1,
      slots_pro: 1,
      slots_max: 2,
      slots_ultra: 4,
      cap_pro: 300,
      cap_max: 400,
      cap_ultra: 400,
      max_level_default: 5,
      max_level_ultra: 6,
      price_pro: 299,
      price_max: 499,
      price_ultra: 799,
      part_purge_days: 30,
    });
  });

  it("the Play ids follow the spec", () => {
    expect(Object.values(tiers).map((t) => [t.productId, t.basePlanId])).toEqual([
      ["ally_pro", "monthly"],
      ["ally_max", "monthly"],
      ["ally_ultra", "monthly"],
    ]);
  });

  it("the day pass and slot-unlock constants are gone from the SQL", () => {
    for (const gone of ["pass_hours", "pass_cap", "max_companions", "price_day_pass"]) {
      expect(sql[gone], `ally_private.${gone}() should have been dropped`).toBeUndefined();
    }
  });

  it("every SQL plan constant has a config counterpart (nothing in SQL that config does not know)", () => {
    const planish = Object.keys(sql).filter((k) => /^(slots_|cap_|price_|max_level_|trial_)/.test(k));
    expect(planish.sort()).toEqual(Object.keys(expected).filter((k) => /^(slots_|cap_|price_|max_level_|trial_)/.test(k)).sort());
  });
});

// B3: trust_decay() hardcodes the level thresholds and the decay amount.
function latestTrustDecay(): string {
  let latest = "";
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    const m = sql.match(/create(?:\s+or\s+replace)?\s+function\s+ally_private\.trust_decay\(\)[\s\S]*?\nend \$\$;/i);
    if (m) latest = m[0]; // later migrations win
  }
  return latest;
}

describe("trust_decay() matches src/lib/trust.ts", () => {
  const fn = latestTrustDecay();

  it("is defined in the migrations", () => {
    expect(fn).not.toBe("");
  });

  it("uses the LEVELS thresholds", () => {
    const m = fn.match(/v_threshold\s*:=\s*case\s+v_level\s+((?:when\s+\d+\s+then\s+\d+\s+)+)else\s+0\s+end/i);
    expect(m, "v_threshold case not found").not.toBeNull();
    const sqlLevels = [...m![1].matchAll(/when\s+(\d+)\s+then\s+(\d+)/gi)].map((x) => ({ level: Number(x[1]), tp: Number(x[2]) }));
    expect(sqlLevels).toEqual(LEVELS.map((l) => ({ level: l.level, tp: l.tp })));
  });

  it("subtracts DECAY_POINTS", () => {
    const m = fn.match(/greatest\(0,\s*v_points\s*-\s*(\d+)\)/i);
    expect(m, "decay subtraction not found").not.toBeNull();
    expect(Number(m![1])).toBe(DECAY_POINTS);
  });
});
