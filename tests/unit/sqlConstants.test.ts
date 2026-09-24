import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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
    expect(expected).toEqual({ free_daily: 100, pass_hours: 24, pass_cap: 2000, max_companions: 3, part_purge_days: 30, price_day_pass: 49 });
  });
});
