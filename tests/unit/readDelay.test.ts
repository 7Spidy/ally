import { describe, it, expect } from "vitest";
import { BUSY_ENERGY, READ_DELAY_MS, readDelayMs, tierFor, type ReadTier } from "@/lib/readDelay";
import { PERSONAS } from "@/personas/registry";
import * as heart from "@/lib/heart";

const TIERS: ReadTier[] = ["free", "busy", "asleep"];

describe("readDelayMs", () => {
  it("stays inside each tier's range at both ends and in the middle", () => {
    const ranges: Record<ReadTier, [number, number]> = { free: [1000, 2000], busy: [3000, 5000], asleep: [6000, 8000] };
    for (const tier of TIERS) {
      const [lo, hi] = ranges[tier];
      expect(READ_DELAY_MS[tier]).toEqual([lo, hi]);
      for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
        const ms = readDelayMs(tier, r);
        expect(ms, `${tier} @ ${r}`).toBeGreaterThanOrEqual(lo);
        expect(ms, `${tier} @ ${r}`).toBeLessThanOrEqual(hi);
      }
      expect(readDelayMs(tier, 0)).toBe(lo);
    }
  });

  it("clamps a random value outside [0, 1)", () => {
    expect(readDelayMs("free", -3)).toBe(1000);
    expect(readDelayMs("busy", 7)).toBeLessThanOrEqual(5000);
  });

  it("each tier is slower than the one before", () => {
    expect(READ_DELAY_MS.free[1]).toBeLessThanOrEqual(READ_DELAY_MS.busy[0]);
    expect(READ_DELAY_MS.busy[1]).toBeLessThanOrEqual(READ_DELAY_MS.asleep[0]);
  });
});

describe("tierFor", () => {
  const ids = Object.keys(PERSONAS);

  it("covers all 32 faces", () => {
    expect(ids).toHaveLength(32);
  });

  it("every block of every persona resolves to a tier, over a full week of minutes", () => {
    for (const id of ids) {
      const p = PERSONAS[id];
      const seen = new Set<ReadTier>();
      // 2026-11-02 is a Monday; step through seven days in 15-minute increments.
      const start = Date.UTC(2026, 10, 2, 0, 0) - 5.5 * 3600 * 1000;
      for (let i = 0; i < 7 * 24 * 4; i++) {
        const h = heart.now({ id: "c_x", createdAt: start }, start + i * 15 * 60 * 1000, p);
        const tier = tierFor(h, p);
        expect(TIERS, `${id} @ step ${i}`).toContain(tier);
        seen.add(tier);
      }
      // Everyone sleeps and everyone is free at some point in a week.
      expect(seen.has("asleep"), `${id} sleeps`).toBe(true);
      expect(seen.has("free"), `${id} has free time`).toBe(true);
    }
  });

  it("the asleep stretch maps to asleep", () => {
    for (const id of ids) {
      const p = PERSONAS[id];
      const start = Date.UTC(2026, 10, 3, 0, 0) - 5.5 * 3600 * 1000; // Tuesday, 00:00 IST
      const h = heart.now({ id: "c_x", createdAt: start }, start, p);
      if (h.block.row === -1 && h.block.presence === "Asleep") expect(tierFor(h, p)).toBe("asleep");
    }
    // Ira, 03:00 on a Tuesday, is asleep.
    const ira = PERSONAS.F01;
    const t = Date.UTC(2026, 10, 3, 3, 0) - 5.5 * 3600 * 1000;
    const h = heart.now({ id: "c_x", createdAt: t }, t, ira);
    expect(h.block.presence).toBe("Asleep");
    expect(tierFor(h, ira)).toBe("asleep");
  });

  it("a weekend open plan (row -1, awake) is not asleep", () => {
    const ira = PERSONAS.F01;
    // Saturday 2026-11-07, 10:30 IST.
    const t = Date.UTC(2026, 10, 7, 10, 30) - 5.5 * 3600 * 1000;
    const h = heart.now({ id: "c_x", createdAt: t }, t, ira);
    if (h.block.row === -1) expect(tierFor(h, ira)).not.toBe("asleep");
  });

  it("a work block is busy and an open block is free", () => {
    const ira = PERSONAS.F01;
    expect(ira.engine.energy["At work"]).toBe("busy");
    expect(tierFor({ block: { row: 3, presence: "At work", activity: "", card: "" } }, ira)).toBe("busy");
    expect(tierFor({ block: { row: 5, presence: "Open", activity: "", card: "" } }, ira)).toBe("free");
    expect(tierFor({ block: { row: 5, presence: "No such presence", activity: "", card: "" } }, ira)).toBe("free");
  });
});

describe("BUSY_ENERGY", () => {
  it("is seeded with busy, focused and distracted", () => {
    for (const w of ["busy", "focused", "distracted"]) expect(BUSY_ENERGY.has(w)).toBe(true);
  });

  it("every word in it is an energy word some persona actually uses", () => {
    const used = new Set(Object.values(PERSONAS).flatMap((p) => Object.values(p.engine.energy)));
    const dead = [...BUSY_ENERGY].filter((w) => !used.has(w));
    expect(dead, `energy words no persona uses: ${JSON.stringify(dead)}`).toEqual([]);
  });

  it("no sleepy, waking or winding-down word is busy", () => {
    for (const w of BUSY_ENERGY) {
      expect(/groggy|sleepy|asleep|dead to the world|winding down|cosy|soft, present/i.test(w), w).toBe(false);
    }
  });
});
