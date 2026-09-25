// First-run visuals spec §6: order, river rows, gesture maths, and the
// committed asset set (dimensions read from WebP headers, no sharp at test time).
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { SPLASH_ORDER, riverOrder, riverRows } from "@/lib/firstRun/order";
import {
  applyDrag,
  decideRelease,
  springStep,
  smoothVelocity,
  hintBalance,
  DISABLED_LIMIT,
  RUBBER_START,
  RUBBER_FACTOR,
} from "@/lib/firstRun/gesture";

const ROOT = path.resolve(__dirname, "../..");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "public/assets/manifest.json"), "utf8")) as {
  templates: { id: string; gender: "woman" | "man" }[];
};
const MANIFEST_IDS = manifest.templates.map((t) => t.id);
const NONE = { woman: false, man: false };

describe("SPLASH_ORDER", () => {
  it("has exactly the 32 manifest ids, each once", () => {
    expect(SPLASH_ORDER).toHaveLength(32);
    expect(new Set(SPLASH_ORDER).size).toBe(32);
    expect([...SPLASH_ORDER].sort()).toEqual([...MANIFEST_IDS].sort());
  });

  it("leads with the curated eight", () => {
    expect(SPLASH_ORDER.slice(0, 8)).toEqual(["F04", "M04", "F09", "M11", "F07", "M09", "F12", "M02"]);
  });

  it("strictly alternates genders", () => {
    const gender = new Map(manifest.templates.map((t) => [t.id, t.gender]));
    for (let i = 1; i < SPLASH_ORDER.length; i++) {
      expect(gender.get(SPLASH_ORDER[i])).not.toBe(gender.get(SPLASH_ORDER[i - 1]));
    }
  });
});

describe("riverRows", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `X${String(i).padStart(2, "0")}`);

  it("splits by index parity", () => {
    const list = ids(16);
    const [r0, r1] = riverRows(list);
    expect(r0.slice(0, 8)).toEqual(list.filter((_, i) => i % 2 === 0));
    expect(r1.slice(0, 8)).toEqual(list.filter((_, i) => i % 2 === 1));
    expect(r0).toHaveLength(8);
    expect(r1).toHaveLength(8);
  });

  it.each([1, 2, 3, 15, 16])("gives each row at least 6 tiles for a pool of %i", (n) => {
    const list = ids(n);
    const [r0, r1] = riverRows(list);
    expect(r0.length).toBeGreaterThanOrEqual(6);
    expect(r1.length).toBeGreaterThanOrEqual(6);
    for (const id of [...r0, ...r1]) expect(list).toContain(id);
  });

  it("repeats a short row in order", () => {
    const [r0, r1] = riverRows(["A", "B", "C"]);
    expect(r0).toEqual(["A", "C", "A", "C", "A", "C"]);
    expect(r1).toEqual(["B", "B", "B", "B", "B", "B"]);
  });

  it("returns [[], []] for an empty pool", () => {
    expect(riverRows([])).toEqual([[], []]);
  });

  it("riverOrder filters SPLASH_ORDER to the pool, strongest first", () => {
    expect(riverOrder(["F01", "F04", "F09", "M04"])).toEqual(["F04", "M04", "F09", "F01"]);
    expect(riverOrder([])).toEqual([]);
  });
});

describe("applyDrag", () => {
  const A = 600; // half-height 300 px maps to b = 1

  it("is linear inside ±0.85", () => {
    expect(applyDrag(0, 150, A)).toBeCloseTo(0.5);
    expect(applyDrag(0, -150, A)).toBeCloseTo(-0.5);
    expect(applyDrag(0.2, 30, A)).toBeCloseTo(0.3);
    expect(applyDrag(0, 255, A)).toBeCloseTo(0.85);
  });

  it("rubber-bands beyond ±0.85", () => {
    const raw = 1.0; // 300 px
    const expected = RUBBER_START + (raw - RUBBER_START) * RUBBER_FACTOR;
    expect(applyDrag(0, 300, A)).toBeCloseTo(expected);
    expect(applyDrag(0, -300, A)).toBeCloseTo(-expected);
  });

  it("clamps at ±1", () => {
    expect(applyDrag(0, 10000, A)).toBe(1);
    expect(applyDrag(0, -10000, A)).toBe(-1);
  });

  it("clamps a disabled side at ±0.12", () => {
    expect(applyDrag(0, 300, A, { woman: true, man: false })).toBe(DISABLED_LIMIT);
    expect(applyDrag(0, -300, A, { woman: false, man: true })).toBe(-DISABLED_LIMIT);
    // the enabled side is unaffected
    expect(applyDrag(0, -150, A, { woman: true, man: false })).toBeCloseTo(-0.5);
    expect(DISABLED_LIMIT).toBe(0.12);
  });
});

describe("decideRelease", () => {
  it("commits past ±0.42 only", () => {
    expect(decideRelease(0.41, 0, NONE)).toBeNull();
    expect(decideRelease(0.43, 0, NONE)).toBe("woman");
    expect(decideRelease(-0.41, 0, NONE)).toBeNull();
    expect(decideRelease(-0.43, 0, NONE)).toBe("man");
  });

  it("commits on velocity alone", () => {
    expect(decideRelease(0, 0.95, NONE)).toBe("woman");
    expect(decideRelease(0, -0.95, NONE)).toBe("man");
    expect(decideRelease(0, 0.85, NONE)).toBeNull();
  });

  it("returns null toward a disabled side", () => {
    expect(decideRelease(0.9, 0, { woman: true, man: false })).toBeNull();
    expect(decideRelease(0, 2, { woman: true, man: false })).toBeNull();
    expect(decideRelease(-0.9, 0, { woman: false, man: true })).toBeNull();
    expect(decideRelease(-0.9, 0, { woman: true, man: false })).toBe("man");
  });

  it("returns null when both sides are disabled", () => {
    const both = { woman: true, man: true };
    expect(decideRelease(1, 0, both)).toBeNull();
    expect(decideRelease(-1, 0, both)).toBeNull();
    expect(decideRelease(0, 5, both)).toBeNull();
  });
});

describe("gesture helpers", () => {
  it("smooths velocity 0.7 / 0.3", () => {
    expect(smoothVelocity(1, 0)).toBeCloseTo(0.7);
    expect(smoothVelocity(0, 1)).toBeCloseTo(0.3);
  });

  it("the spring settles to its target without overshooting past ±1", () => {
    let b = 0.6;
    let v = 0;
    for (let i = 0; i < 240; i++) [b, v] = springStep(b, v, 0, 1 / 60);
    expect(Math.abs(b)).toBeLessThan(1e-3);
    b = 0.5;
    v = 0;
    let max = 0;
    for (let i = 0; i < 240; i++) {
      [b, v] = springStep(b, v, 1, 1 / 60);
      max = Math.max(max, b);
    }
    expect(b).toBeCloseTo(1, 3);
    expect(max).toBeLessThan(1.1);
  });

  it("the hint wiggle starts and ends at rest and stays small", () => {
    expect(hintBalance(0)).toBeCloseTo(0);
    expect(hintBalance(1)).toBeCloseTo(0);
    for (let p = 0; p <= 1; p += 0.05) expect(Math.abs(hintBalance(p))).toBeLessThanOrEqual(0.1);
  });
});

// ---- asset guard ----

/** Width and height from a WebP header (VP8, VP8L or VP8X). */
function webpSize(buf: Buffer): { width: number; height: number } {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") throw new Error("not a WebP");
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) throw new Error("bad VP8 start code");
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (buf[20] !== 0x2f) throw new Error("bad VP8L signature");
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  throw new Error(`unknown WebP chunk ${chunk}`);
}

describe("first-run asset guard", () => {
  const dir = path.join(ROOT, "public/assets/first-run");

  it("has the cropped mark", () => {
    const p = path.join(dir, "mark.png");
    expect(existsSync(p)).toBe(true);
    const buf = readFileSync(p);
    expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(buf.readUInt32BE(20)).toBe(172); // IHDR height
  });

  it.each(MANIFEST_IDS)("reveal %s is 540x960 and at most 60 KB", (id) => {
    const p = path.join(dir, "reveal", `${id}.webp`);
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBeLessThanOrEqual(60 * 1024);
    expect(webpSize(readFileSync(p))).toEqual({ width: 540, height: 960 });
  });

  it.each(MANIFEST_IDS)("tile %s is 432x540 and at most 35 KB", (id) => {
    const p = path.join(dir, "tile", `${id}.webp`);
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBeLessThanOrEqual(35 * 1024);
    expect(webpSize(readFileSync(p))).toEqual({ width: 432, height: 540 });
  });

  it("holds exactly the 64 WebP files, one reveal and one tile per template", () => {
    const want = MANIFEST_IDS.map((id) => `${id}.webp`).sort();
    expect(readdirSync(path.join(dir, "reveal")).filter((f) => f.endsWith(".webp")).sort()).toEqual(want);
    expect(readdirSync(path.join(dir, "tile")).filter((f) => f.endsWith(".webp")).sort()).toEqual(want);
  });
});
