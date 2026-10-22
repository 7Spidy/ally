import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DECAY_POINTS, LEVELS } from "@/lib/trust";
import { FREE_DAILY, PASS_HOURS, PASS_CAP, MAX_COMPANIONS, PART_PURGE_DAYS, PRICE_DAY_PASS } from "@/lib/config";

// P2 spec §5: the server-state RPCs hardcode the ledger constants as
// `ally_private.<name>() ... select <n>` functions. This reads the latest
// definition of each from the migrations and fails if it no longer matches
// src/lib/config.ts, so neither side can change alone.
const MIGRATIONS = path.join(__dirname, "../../supabase/migrations");

function sqlConstants(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    const re = /create(?:\s+or\s+replace)?\s+function\s+ally_private\.(\w+)\(\)\s+returns\s+int\b[^$]*\$\$\s*select\s+(\d+)\s*\$\$/gi;
    for (const m of sql.matchAll(re)) out[m[1]] = Number(m[2]); // later migrations win
  }
  return out;
}

describe("SQL constants match src/lib/config.ts", () => {
  const sql = sqlConstants();
  const expected: Record<string, number> = {
    free_daily: FREE_DAILY,
    pass_hours: PASS_HOURS,
    pass_cap: PASS_CAP,
    max_companions: MAX_COMPANIONS,
    part_purge_days: PART_PURGE_DAYS,
    price_day_pass: PRICE_DAY_PASS,
  };

  for (const [name, value] of Object.entries(expected)) {
    it(`ally_private.${name}() = ${value}`, () => {
      expect(sql[name], `ally_private.${name}() not found in supabase/migrations`).toBeDefined();
      expect(sql[name]).toBe(value);
    });
  }

  it("pins the current values, so a change on either side is deliberate", () => {
    expect(expected).toEqual({ free_daily: 100, pass_hours: 24, pass_cap: 200, max_companions: 3, part_purge_days: 30, price_day_pass: 49 });
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
