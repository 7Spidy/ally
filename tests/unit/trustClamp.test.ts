import { describe, it, expect } from "vitest";
import { deeperLevelAvailable, effectiveLevel, shownLevelUp } from "@/lib/trust";
import { PLAN_CONFIG } from "@/lib/config";

const { defaultMaxLevel } = PLAN_CONFIG;
const ultraMax = PLAN_CONFIG.tiers.ultra.maxLevel;

describe("trust level clamp", () => {
  it("holds a non-Ultra plan at level 5 and lets Ultra reach 6", () => {
    expect(defaultMaxLevel).toBe(5);
    expect(ultraMax).toBe(6);
    expect(effectiveLevel(6, defaultMaxLevel)).toBe(5);
    expect(effectiveLevel(6, ultraMax)).toBe(6);
  });

  it("never lifts a level that is below the ceiling", () => {
    for (const l of [1, 2, 3, 4, 5]) expect(effectiveLevel(l, defaultMaxLevel)).toBe(l);
  });

  it("flags a deeper level only when the stored trust is past the ceiling", () => {
    expect(deeperLevelAvailable(6, defaultMaxLevel)).toBe(true);
    expect(deeperLevelAvailable(5, defaultMaxLevel)).toBe(false);
    expect(deeperLevelAvailable(6, ultraMax)).toBe(false);
  });

  it("upgrading lifts the clamp with the same stored level, nothing lost", () => {
    const stored = 6;
    expect(effectiveLevel(stored, defaultMaxLevel)).toBe(5);
    expect(effectiveLevel(stored, ultraMax)).toBe(6); // same stored value, new ceiling
  });

  it("a level-up past the ceiling is stored but not played", () => {
    expect(shownLevelUp(6, defaultMaxLevel)).toBeNull();
    expect(shownLevelUp(5, defaultMaxLevel)).toBe(5);
    expect(shownLevelUp(6, ultraMax)).toBe(6);
    expect(shownLevelUp(null, defaultMaxLevel)).toBeNull();
  });
});
