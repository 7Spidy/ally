import { describe, expect, it } from "vitest";
import { buildCoreDeck, computeCore, coreForFace, deckTemplates, type Template } from "@/lib/engine";
import { CORE_MAP } from "@/lib/coreMap";
import { isLive } from "@/lib/live";
import { LIVE_TEMPLATES } from "@/personas/registry";
import { emptyAnswers, type Answers, type Core, type CoreId, type Gender } from "@/state/schema";
import manifest from "../../public/assets/manifest.json";

const templates = manifest.templates as unknown as Template[];
const CORES: CoreId[] = ["ROMANTIC", "PSYCH", "MONEY", "TRAINER", "FRIEND"];
const live = (templateId: string, primary: CoreId | null) => isLive({ templateId, core: { primary } }, false);
const core = (primary: CoreId | null, secondary: CoreId | null = null): Core => ({ primary, secondary, weight: secondary ? 70 : 100, ranked: [] });

describe("a deck never shows a face that would give mock replies", () => {
  it("every one of the 32 faces is listed live for everyone", () => {
    expect(Object.keys(LIVE_TEMPLATES).sort()).toEqual(templates.map((t) => t.id).sort());
    for (const a of Object.values(LIVE_TEMPLATES)) expect(a).toBe("all");
  });

  it("each core's deck holds only faces that are live for a user of that core", () => {
    for (const gender of ["woman", "man"] as Gender[]) {
      for (const c of CORES) {
        const deck = deckTemplates(templates, gender, undefined, c);
        expect(deck.length, `${gender} ${c}`).toBeGreaterThan(0);
        for (const t of deck) expect(live(t.id, c), `${t.id} for ${c}`).toBe(true);
      }
    }
  });

  it("a Money core user sees Money faces only", () => {
    expect(deckTemplates(templates, "woman", undefined, "MONEY").map((t) => t.id).sort()).toEqual(["F11", "F13"]);
    expect(deckTemplates(templates, "man", undefined, "MONEY").map((t) => t.id)).toEqual(["M06"]);
  });

  it("the face a user can pick is always live, for any answers, gender and set of used faces", () => {
    const opts = [0, 1, 2, 3];
    const pressures = ["money", "health", "head", "alone", "notgood", "change"] as const;
    let checked = 0;
    for (let run = 0; run < 2000; run++) {
      const a: Answers = { ...emptyAnswers(), q5: opts[run % 4], q6: opts[(run >> 2) % 4], q7: opts[(run >> 4) % 4], q8: opts[(run * 7) % 4], q9: opts[(run * 3) % 4], q10: pressures[run % 6], q11: [], tb: null };
      const gender: Gender = run % 2 ? "man" : "woman";
      const ids = templates.filter((t) => t.gender === gender).map((t) => t.id);
      const excluded = new Set(ids.filter((_, i) => (run * 31 + i * 17) % 100 < (run % 90)));
      const computed = computeCore(a);
      for (const t of buildCoreDeck(templates, gender, excluded, computed.ranked)) {
        // The deck may fall back to another core when the user's own is used up. The core stored on the companion is aligned to the face.
        expect(live(t.id, coreForFace(computed, t.id).primary), `${t.id} run ${run}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("without the alignment, a fallback pick would be a mismatch, which is why the core is aligned", () => {
    expect(live("F11", "ROMANTIC")).toBe(false);
    expect(live("F11", coreForFace(core("ROMANTIC"), "F11").primary)).toBe(true);
  });
});

describe("coreForFace", () => {
  it("returns the same core when it already matches the face's primary", () => {
    const c = core("MONEY");
    expect(coreForFace(c, "F11")).toBe(c);
  });
  it("aligns primary, secondary and weight to the face's own core when they differ, keeping ranked", () => {
    const c = { ...core("ROMANTIC", "TRAINER"), ranked: [{ id: "ROMANTIC" as CoreId, score: 9 }] };
    expect(coreForFace(c, "F13")).toEqual({ primary: "MONEY", secondary: "FRIEND", weight: 70, ranked: c.ranked });
    expect(coreForFace(c, "F11")).toEqual({ primary: "MONEY", secondary: null, weight: 100, ranked: c.ranked });
  });
  it("leaves an unknown template untouched", () => {
    const c = core("MONEY");
    expect(coreForFace(c, "F99")).toBe(c);
  });
  it("agrees with the casting map for all 32 faces", () => {
    for (const [id, [primary, secondary]] of Object.entries(CORE_MAP)) {
      const out = coreForFace(core(primary === "MONEY" ? "TRAINER" : "MONEY"), id);
      expect([out.primary, out.secondary], id).toEqual([primary, secondary]);
    }
  });
});
