import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LEVEL_BADGE_AWAY_MS, LEVEL_BADGE_MS, awayLongEnough } from "@/components/chat/useLevelBadge";
import { LevelBadge } from "@/components/chat/LevelBadge";
import { F01 } from "@/personas/persona";

describe("level badge trigger", () => {
  it("shows for one second", () => {
    expect(LEVEL_BADGE_MS).toBe(1000);
  });

  it("re-shows on return only after 60 s or more hidden", () => {
    const t = 1_000_000;
    expect(LEVEL_BADGE_AWAY_MS).toBe(60_000);
    expect(awayLongEnough(null, t)).toBe(false); // never hidden
    expect(awayLongEnough(t - 59_999, t)).toBe(false);
    expect(awayLongEnough(t - 60_000, t)).toBe(true);
    expect(awayLongEnough(t - 10 * 60_000, t)).toBe(true);
  });
});

describe("LevelBadge markup", () => {
  const html = (level: number) => renderToStaticMarkup(createElement(LevelBadge, { name: F01.levels[Math.min(6, Math.max(1, level)) - 1].name, level }));
  const filled = (h: string) => (h.match(/class="[^"]*_filled_[^"]*"/g) ?? []).length;
  const segs = (h: string) => (h.match(/class="[^"]*_seg_[^"]*"/g) ?? []).length;

  it("names the level and fills the first n of six segments", () => {
    for (let level = 1; level <= 6; level++) {
      const h = html(level);
      expect(h).toContain(F01.levels[level - 1].name);
      expect(segs(h)).toBe(6);
      expect(filled(h)).toBe(level);
    }
  });

  it("reads '<name>, level <n> of 6' to screen readers, and shows no 'L1' or digits", () => {
    const h = html(3);
    expect(h).toContain("Trusted, level 3 of 6");
    const visible = h.replace(/<span class="[^"]*sr[^"]*">[^<]*<\/span>/, "").replace(/<[^>]+>/g, "");
    expect(visible).toBe("Trusted");
    expect(visible).not.toMatch(/\d|\bL\d/);
  });

  it("clamps out-of-range levels", () => {
    expect(filled(html(0))).toBe(1);
    expect(filled(html(9))).toBe(6);
  });
});
