import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FG_HEX, INK_HEX, MIN_CONTRAST, contrast, luminance, onColor, parseHex } from "@/lib/onColor";

const manifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../ally-manifest.json"), "utf8")) as { templates: { id: string; palette: string }[] };
const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

describe("onColor", () => {
  it("matches the --ink and --fg tokens in globals.css", () => {
    expect(css).toMatch(new RegExp(`--ink:\\s*${INK_HEX};`, "i"));
    expect(css).toMatch(new RegExp(`--fg:\\s*${FG_HEX};`, "i"));
  });

  it("parses short and long hex, and reads garbage as black", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#B03A48")).toEqual([176, 58, 72]);
    expect(parseHex("nope")).toEqual([0, 0, 0]);
  });

  it("white is brighter than black, and contrast is symmetric and spans 1 to 21", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(luminance("#000000")).toBeCloseTo(0, 5);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 3);
    expect(contrast("#336699", "#ffffff")).toBeCloseTo(contrast("#ffffff", "#336699"), 8);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 8);
  });

  it("picks the ink on a light fill and the fg on a dark one", () => {
    expect(onColor("#f4efe6")).toBe(INK_HEX);
    expect(onColor("#ffd966")).toBe(INK_HEX);
    expect(onColor("#1d1929")).toBe(FG_HEX);
    expect(onColor("#2a3f7a")).toBe(FG_HEX);
  });

  it("never picks the worse of the two tokens", () => {
    for (const hex of ["#B03A48", "#5b8a72", "#d98e04", "#0f4c5c"]) {
      const chosen = onColor(hex);
      const other = chosen === INK_HEX ? FG_HEX : INK_HEX;
      expect(contrast(hex, chosen)).toBeGreaterThanOrEqual(contrast(hex, other));
    }
  });

  it("falls back to pure white or black only where neither token reaches 4.5:1", () => {
    // #2E7D6B (Ira's neighbour F03): the fg token gives 4.3, white gives 4.9.
    expect(onColor("#2E7D6B")).toBe("#ffffff");
    expect(onColor("#8A6E2F")).toBe("#ffffff");
    expect(contrast("#2E7D6B", FG_HEX)).toBeLessThan(MIN_CONTRAST);
    // A palette a token already handles keeps the token.
    expect([INK_HEX, FG_HEX]).toContain(onColor("#B03A48"));
    expect([INK_HEX, FG_HEX]).toContain(onColor("#f4efe6"));
  });

  it("all 32 manifest palettes reach 4.5:1 with the chosen text colour", () => {
    expect(manifest.templates).toHaveLength(32);
    const low = manifest.templates
      .map((t) => ({ id: t.id, palette: t.palette, ratio: contrast(t.palette, onColor(t.palette)) }))
      .filter((r) => r.ratio < 4.5);
    expect(low, `below 4.5:1: ${JSON.stringify(low)}`).toEqual([]);
  });
});
