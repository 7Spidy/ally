// B1: five cores, direct scoring, the tiebreaker, core-bound decks, and the
// small pure pieces around the tutorial and the Constellation.
import { describe, it, expect, afterEach } from "vitest";
import {
  CLOSE_MARGIN,
  CORE_ORDER,
  PRESSURES,
  PRESSURE_OWNER,
  PRESSURE_POINTS,
  SCORE,
  TIEBREAK_POINTS,
  assignCore,
  buildCoreDeck,
  computeCore,
  deckTemplates,
  needsTiebreak,
  scoreCores,
  type RankedCore,
  type Template,
} from "@/lib/engine";
import { CORE_MAP, DECK_HIDDEN, castsAs } from "@/lib/coreMap";
import { createHeartbeat } from "@/lib/sound/heartbeat";
import { emptyAnswers, freshFlow, type Answers, type CoreId, type Gender } from "@/state/schema";
import { invalidationFor } from "../../app/onboarding/_lib/invalidate";
import { backTargetFor } from "../../app/onboarding/_lib/steps";
import { constellationFaces, deckFor, proposeFor } from "../../app/onboarding/_lib/propose";
import manifest from "../../public/assets/manifest.json";

const templates = manifest.templates as unknown as Template[];
const CORES: CoreId[] = ["ROMANTIC", "PSYCH", "MONEY", "TRAINER", "FRIEND"];
const OPTIONS = [0, 1, 2, 3];

function answers(over: Partial<Answers> = {}): Answers {
  return { ...emptyAnswers(), ...over };
}

/** Every answer set: 4^5 option combinations x 6 pressures, no tiebreak. */
function* everyAnswerSet(): Generator<Answers> {
  for (const q5 of OPTIONS) for (const q6 of OPTIONS) for (const q7 of OPTIONS) for (const q8 of OPTIONS) for (const q9 of OPTIONS)
    for (const q10 of PRESSURES) yield { q5, q6, q7, q8, q9, q10, q11: [], tb: null };
}

function idsOf(deck: Template[]): string[] {
  return deck.map((t) => t.id).sort();
}

describe("scoring", () => {
  it("the score table matches the spec: every option of q5..q9 names 1 or 2 cores, 2 points to the lead", () => {
    for (const q of ["q5", "q6", "q7", "q8", "q9"] as const) {
      expect(SCORE[q].length).toBe(4);
      for (const opt of SCORE[q]) {
        const pts = Object.values(opt);
        expect(Math.max(...pts)).toBe(2);
        expect(pts.length).toBeGreaterThanOrEqual(1);
        expect(pts.length).toBeLessThanOrEqual(2);
      }
    }
    expect(PRESSURE_POINTS).toBe(3);
    expect(TIEBREAK_POINTS).toBe(3);
    expect(CLOSE_MARGIN).toBe(2);
  });

  it("each pressure adds exactly 3 points, to its owner only", () => {
    const base = answers({ q5: 2, q6: 3, q7: 1, q8: 0, q9: 3 });
    const plain = new Map(scoreCores(base).map((r) => [r.id, r.score]));
    for (const pressure of PRESSURES) {
      const withPressure = new Map(scoreCores({ ...base, q10: pressure }).map((r) => [r.id, r.score]));
      for (const id of CORES) {
        const delta = withPressure.get(id)! - plain.get(id)!;
        expect(delta, `${pressure} -> ${id}`).toBe(id === PRESSURE_OWNER[pressure] ? PRESSURE_POINTS : 0);
      }
    }
  });

  it("a pressure alone puts its owner first", () => {
    for (const pressure of PRESSURES) {
      expect(scoreCores(answers({ q10: pressure }))[0].id).toBe(PRESSURE_OWNER[pressure]);
    }
  });

  it("every one of the five cores is reachable, and ranked always lists all five", () => {
    const reached = new Set<CoreId>();
    for (const a of everyAnswerSet()) {
      const { primary, ranked } = computeCore(a);
      reached.add(primary);
      expect(ranked.map((r) => r.id).sort()).toEqual([...CORES].sort());
    }
    expect([...reached].sort()).toEqual([...CORES].sort());
  });

  it("scores are integers, sorted descending, and stable in CORE_ORDER on equal scores", () => {
    for (const a of everyAnswerSet()) {
      const ranked = scoreCores(a);
      for (let i = 0; i < ranked.length; i++) {
        expect(Number.isInteger(ranked[i].score)).toBe(true);
        if (i === 0) continue;
        const prev = ranked[i - 1];
        expect(prev.score).toBeGreaterThanOrEqual(ranked[i].score);
        if (prev.score === ranked[i].score) expect(CORE_ORDER.indexOf(prev.id)).toBeLessThan(CORE_ORDER.indexOf(ranked[i].id));
      }
    }
  });

  it("identical answers give an identical core", () => {
    const a = answers({ q5: 1, q6: 2, q7: 0, q8: 3, q9: 1, q10: "money" });
    expect(computeCore(a)).toEqual(computeCore({ ...a }));
  });

  it("a stale pre-B1 float scores nothing instead of throwing", () => {
    const ranked = scoreCores(answers({ q5: 0.4, q6: 0.5, q10: "head" }));
    expect(ranked[0]).toEqual({ id: "PSYCH", score: 3 });
    expect(ranked.slice(1).every((r) => r.score === 0)).toBe(true);
  });

  it("Q11 interests never change the core", () => {
    const a = answers({ q5: 1, q6: 2, q7: 0, q8: 3, q9: 1, q10: "money" });
    expect(computeCore({ ...a, q11: ["music", "food", "people"] })).toEqual(computeCore(a));
  });
});

describe("the tiebreaker", () => {
  it("an exact tie that includes ROMANTIC goes to ROMANTIC with no tiebreak", () => {
    let seen = 0;
    for (const a of everyAnswerSet()) {
      const ranked = scoreCores(a);
      if (ranked[0].score !== ranked[1].score) continue;
      if (ranked[0].id !== "ROMANTIC" && ranked[1].id !== "ROMANTIC") continue;
      seen++;
      expect(ranked[0].id).toBe("ROMANTIC");
      expect(computeCore(a).primary).toBe("ROMANTIC");
      expect(needsTiebreak(ranked, a)).toBeNull();
    }
    expect(seen, "found exact ROMANTIC ties").toBeGreaterThan(0);
  });

  it("an exact tie between two other cores is a close call and asks the pair in rank order", () => {
    let seen = 0;
    for (const a of everyAnswerSet()) {
      const ranked = scoreCores(a);
      if (ranked[0].score !== ranked[1].score) continue;
      if (ranked[0].id === "ROMANTIC" || ranked[1].id === "ROMANTIC") continue;
      seen++;
      expect(needsTiebreak(ranked, a)).toEqual([ranked[0].id, ranked[1].id]);
    }
    expect(seen, "found exact non-ROMANTIC ties").toBeGreaterThan(0);
  });

  it("a one-point gap is a close call, including when ROMANTIC is in the top two", () => {
    let withRomantic = 0;
    let without = 0;
    for (const a of everyAnswerSet()) {
      const ranked = scoreCores(a);
      if (ranked[0].score - ranked[1].score !== 1) continue;
      expect(needsTiebreak(ranked, a)).toEqual([ranked[0].id, ranked[1].id]);
      if (ranked[0].id === "ROMANTIC" || ranked[1].id === "ROMANTIC") withRomantic++;
      else without++;
    }
    expect(withRomantic).toBeGreaterThan(0);
    expect(without).toBeGreaterThan(0);
  });

  it("a gap of 2 or more is not a close call", () => {
    for (const a of everyAnswerSet()) {
      const ranked = scoreCores(a);
      if (ranked[0].score - ranked[1].score >= CLOSE_MARGIN) expect(needsTiebreak(ranked, a)).toBeNull();
    }
  });

  it("setting tb resolves every close call, to the core the user picked", () => {
    let resolved = 0;
    for (const a of everyAnswerSet()) {
      const ranked = scoreCores(a);
      const pair = needsTiebreak(ranked, a);
      if (!pair) continue;
      for (const pick of pair) {
        const after = { ...a, tb: pick };
        const rerank = scoreCores(after);
        expect(needsTiebreak(rerank, after), "tb set: never asked twice").toBeNull();
        expect(rerank[0].id).toBe(pick);
        expect(computeCore(after).primary).toBe(pick);
        resolved++;
      }
    }
    expect(resolved).toBeGreaterThan(0);
  });

  it("tb adds TIEBREAK_POINTS to its core and nothing else", () => {
    const a = answers({ q5: 1, q6: 2, q7: 0, q8: 3, q9: 1, q10: "money" });
    const plain = new Map(scoreCores(a).map((r) => [r.id, r.score]));
    const withTb = new Map(scoreCores({ ...a, tb: "TRAINER" }).map((r) => [r.id, r.score]));
    for (const id of CORES) expect(withTb.get(id)! - plain.get(id)!).toBe(id === "TRAINER" ? TIEBREAK_POINTS : 0);
  });
});

describe("assignCore", () => {
  it("never returns ROMANTIC as secondary, with or without a tiebreak", () => {
    for (const a of everyAnswerSet()) {
      for (const tb of [null, ...CORES] as (CoreId | null)[]) {
        expect(computeCore({ ...a, tb }).secondary).not.toBe("ROMANTIC");
      }
    }
    // Directly: ROMANTIC ranked second is skipped for the next core.
    const r = assignCore([
      { id: "FRIEND", score: 9 },
      { id: "ROMANTIC", score: 8 },
      { id: "PSYCH", score: 7 },
      { id: "MONEY", score: 0 },
      { id: "TRAINER", score: 0 },
    ]);
    expect(r).toEqual({ primary: "FRIEND", secondary: "PSYCH", weight: 70 });
  });

  it("names the best non-ROMANTIC core within 3 points, else none", () => {
    const rank = (scores: number[]): RankedCore[] => CORE_ORDER.map((id, i) => ({ id, score: scores[i] })).sort((x, y) => y.score - x.score);
    // PSYCH 7 leads, TRAINER 4 is exactly 3 behind: support.
    expect(assignCore(rank([1, 7, 0, 0, 4]))).toEqual({ primary: "PSYCH", secondary: "TRAINER", weight: 70 });
    // 4 behind: no support.
    expect(assignCore(rank([1, 8, 0, 0, 4]))).toEqual({ primary: "PSYCH", secondary: null, weight: 100 });
    // ROMANTIC primary: the best non-ROMANTIC behind it can support.
    expect(assignCore(rank([9, 7, 0, 0, 0]))).toEqual({ primary: "ROMANTIC", secondary: "PSYCH", weight: 70 });
  });

  it("weight is 70 exactly when there is a secondary", () => {
    for (const a of everyAnswerSet()) {
      const r = computeCore(a);
      expect(r.weight).toBe(r.secondary ? 70 : 100);
      expect(r.secondary).not.toBe(r.primary);
    }
  });
});

describe("the v7 casting map", () => {
  it("has an entry for every manifest template id, and no others", () => {
    expect(Object.keys(CORE_MAP).sort()).toEqual(templates.map((t) => t.id).sort());
  });

  it("never lists a core as both primary and secondary", () => {
    for (const [id, [primary, secondary]] of Object.entries(CORE_MAP)) expect(secondary, id).not.toBe(primary);
  });

  it("castsAs is true for a primary or secondary core, false for the rest and for unknown ids", () => {
    expect(castsAs("F13", "MONEY")).toBe(true);
    expect(castsAs("F13", "FRIEND")).toBe(true);
    expect(castsAs("F13", "TRAINER")).toBe(false);
    expect(castsAs("F99", "ROMANTIC")).toBe(false);
  });

  // Expected sizes come from the map, not from the code under test.
  function expectedIds(gender: Gender, core: CoreId): string[] {
    return Object.entries(CORE_MAP)
      .filter(([id, [p, s]]) => id.startsWith(gender === "woman" ? "F" : "M") && (p === core || s === core) && !(id === "F01" && core === "MONEY"))
      .map(([id]) => id)
      .sort();
  }

  it("first-run deck sizes: ROMANTIC 9 per gender, the others 3 to 5", () => {
    for (const gender of ["woman", "man"] as Gender[]) {
      for (const core of CORES) {
        const deck = deckTemplates(templates, gender, undefined, core);
        expect(idsOf(deck), `${gender} ${core}`).toEqual(expectedIds(gender, core));
        if (core === "ROMANTIC") expect(deck.length, `${gender} ROMANTIC`).toBe(9);
        else {
          expect(deck.length, `${gender} ${core}`).toBeGreaterThanOrEqual(3);
          expect(deck.length, `${gender} ${core}`).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it("F01 is in the woman ROMANTIC deck and in no other core's deck", () => {
    expect(DECK_HIDDEN.F01).toEqual(["MONEY"]);
    expect(deckTemplates(templates, "woman", undefined, "ROMANTIC").map((t) => t.id)).toContain("F01");
    expect(deckTemplates(templates, "woman", undefined, "MONEY").map((t) => t.id)).not.toContain("F01");
    for (const core of CORES.filter((c) => c !== "ROMANTIC")) {
      expect(deckTemplates(templates, "woman", undefined, core).map((t) => t.id), core).not.toContain("F01");
    }
  });

  it("a deck is gender-only when no core is given, and drops excluded faces", () => {
    expect(deckTemplates(templates, "woman").length).toBe(16);
    const excluded = new Set(["F02", "F03"]);
    const deck = deckTemplates(templates, "woman", excluded, "ROMANTIC");
    expect(deck.map((t) => t.id)).not.toContain("F02");
    expect(deck.length).toBe(9 - 2);
  });
});

describe("buildCoreDeck fallback (D4)", () => {
  // TRAINER > FRIEND > PSYCH > the rest.
  const ranked: RankedCore[] = [
    { id: "TRAINER", score: 9 },
    { id: "FRIEND", score: 6 },
    { id: "PSYCH", score: 4 },
    { id: "ROMANTIC", score: 1 },
    { id: "MONEY", score: 0 },
  ];
  const trainerWomen = ["F03", "F06", "F08", "F10"];
  const friendWomen = ["F05", "F09", "F12", "F13"];
  const psychWomen = ["F02", "F04", "F07", "F15"];

  it("uses the user's own core deck when it has faces", () => {
    expect(idsOf(buildCoreDeck(templates, "woman", undefined, ranked))).toEqual(trainerWomen);
  });

  it("falls to the second-ranked core when the first is empty, then the third", () => {
    expect(idsOf(buildCoreDeck(templates, "woman", new Set(trainerWomen), ranked))).toEqual(friendWomen);
    expect(idsOf(buildCoreDeck(templates, "woman", new Set([...trainerWomen, ...friendWomen]), ranked))).toEqual(psychWomen);
  });

  it("falls to the fourth-ranked core when the top three are exhausted", () => {
    const excluded = new Set([...trainerWomen, ...friendWomen, ...psychWomen]);
    // ROMANTIC is fourth in `ranked`; its women minus the excluded ones are what is left.
    const deck = buildCoreDeck(templates, "woman", excluded, ranked);
    expect(idsOf(deck)).toEqual(["F01", "F14", "F16"]);
    expect(idsOf(deck)).toEqual(idsOf(deckTemplates(templates, "woman", excluded, "ROMANTIC")));
  });

  it("falls to the fifth when the top four are exhausted", () => {
    const romanticWomen = ["F01", "F02", "F03", "F05", "F06", "F10", "F14", "F15", "F16"];
    const excluded = new Set([...trainerWomen, ...friendWomen, ...psychWomen, ...romanticWomen]);
    // Only MONEY's F11 is left (F13 and F16 were excluded with the others).
    expect(idsOf(buildCoreDeck(templates, "woman", excluded, ranked))).toEqual(["F11"]);
  });

  it("all five empty for the gender gives an empty deck, the existing empty-pool behaviour", () => {
    const allWomen = new Set(templates.filter((t) => t.gender === "woman").map((t) => t.id));
    expect(buildCoreDeck(templates, "woman", allWomen, ranked)).toEqual([]);
    // The men are untouched.
    expect(buildCoreDeck(templates, "man", allWomen, ranked).length).toBeGreaterThan(0);
  });

  it("a deck is empty exactly when the gender's pool is empty, so deck -> matching cannot loop", () => {
    // Every face is cast for at least one core and never hidden from all of them,
    // so trying all five cores reaches every face. The deck page only redirects to
    // matching on an empty deck, and the gender screen already refuses an empty pool.
    for (const t of templates) {
      const reachable = CORES.some((c) => castsAs(t.id, c) && !DECK_HIDDEN[t.id]?.includes(c));
      expect(reachable, t.id).toBe(true);
    }
    // Randomised exclusions, every ranking order: the union of the five decks is the whole pool.
    for (let run = 0; run < 300; run++) {
      const gender: Gender = run % 2 ? "man" : "woman";
      const genderIds = templates.filter((t) => t.gender === gender).map((t) => t.id);
      const excluded = new Set(genderIds.filter(() => Math.random() < 0.85));
      const order = [...CORES].sort(() => Math.random() - 0.5).map((id, i) => ({ id, score: 5 - i }));
      const deck = buildCoreDeck(templates, gender, excluded, order);
      const poolSize = genderIds.length - excluded.size;
      expect(deck.length === 0, `excluded ${excluded.size}/${genderIds.length}`).toBe(poolSize === 0);
      const union = new Set(CORES.flatMap((c) => deckTemplates(templates, gender, excluded, c).map((t) => t.id)));
      expect(union.size).toBe(poolSize);
    }
  });

  it("counts a parted or active face as excluded, exactly like the round-two pool", () => {
    // Everyone in TRAINER's deck already met: the exclusion set is the union of active and parted.
    expect(idsOf(buildCoreDeck(templates, "woman", new Set(trainerWomen.slice(0, 3)), ranked))).toEqual(["F10"]);
  });

  it("orders the result with orderDeck when a user is given, keeping the same faces", () => {
    const user = { region: "West", age: 26, interests: ["music"] };
    const ordered = buildCoreDeck(templates, "man", undefined, ranked, user);
    expect(idsOf(ordered)).toEqual(idsOf(deckTemplates(templates, "man", undefined, "TRAINER")));
  });

  it("deckFor computes the core from the answers, not from a stale flow.core", () => {
    // MONEY-leaning answers with an empty flow.core.
    const flow = {
      ...freshFlow("first", "matching"),
      deckGender: "woman" as Gender,
      region: "West",
      age: 26,
      answers: answers({ q5: 3, q6: 3, q7: 3, q8: 2, q9: 3, q10: "money" }),
    };
    expect(computeCore(flow.answers).primary).toBe("MONEY");
    const ids = deckFor(flow, templates, new Set());
    expect(ids.sort()).toEqual(["F11", "F13", "F16"]); // MONEY women, F01 hidden
    expect(deckFor({ ...flow, deckGender: null }, templates, new Set())).toEqual([]);
  });
});

describe("invalidation and navigation (B1)", () => {
  it("changing q5..q10 clears the core, the tiebreak and the deck", () => {
    const flow = {
      ...freshFlow("first", "deck"),
      answers: answers({ q5: 1, q6: 1, q7: 1, q8: 1, q9: 1, q10: "money", tb: "PSYCH" }),
      core: { primary: "PSYCH" as const, secondary: null, weight: 100, ranked: [] },
      deckOrder: ["F04", "F07"],
      liked: ["F04"],
      dwell: { F04: 3000 },
      proposed: "F04",
    };
    for (const key of ["q5", "q6", "q7", "q8", "q9", "q10"] as const) {
      const { patch, changed } = invalidationFor(key, flow);
      expect(changed, key).toBe(true);
      expect(patch, key).toMatchObject({ core: { primary: null }, deckOrder: [], liked: [], dwell: {}, proposed: null });
      expect(patch!.answers!.tb, key).toBeNull();
      expect(patch!.answers!.q10, key).toBe("money"); // only tb is cleared
    }
  });

  it("changing q5..q10 before there is anything to lose is not a change", () => {
    const flow = { ...freshFlow("first", "questions/warmth"), answers: answers({ q5: 1 }) };
    expect(invalidationFor("q5", flow).changed).toBe(false);
  });

  it("changing the tiebreak pick clears the core and deck but keeps the answers", () => {
    const flow = { ...freshFlow("first", "matching"), answers: answers({ tb: "PSYCH" }), core: { primary: "PSYCH" as const, secondary: null, weight: 100, ranked: [] } };
    const { patch, changed } = invalidationFor("tb", flow);
    expect(changed).toBe(true);
    expect(patch).toMatchObject({ core: { primary: null }, deckOrder: [] });
    expect(patch).not.toHaveProperty("answers");
  });

  it("back from matching goes to the tiebreak only if one was played", () => {
    expect(backTargetFor("matching", true)).toBe("/onboarding/questions/tiebreak");
    expect(backTargetFor("matching", false)).toBe("/onboarding/questions/interests");
    expect(backTargetFor("matching")).toBe("/onboarding/questions/interests");
    expect(backTargetFor("questions/tiebreak")).toBe("/onboarding/questions/interests");
    expect(backTargetFor("questions/pressure")).toBe("/onboarding/questions/offday");
  });
});

describe("the proposal is stable across replays", () => {
  const flow = {
    ...freshFlow("first", "choosing"),
    deckOrder: ["F02", "F03", "F05", "F06", "F10", "F14", "F15", "F16", "F01"],
    liked: ["F02", "F05", "F10", "F14"],
    dwell: { F02: 4000, F05: 9000, F10: 2500, F14: 700 },
  };

  it("proposeFor returns the same face every time for the same flow", () => {
    const first = proposeFor(flow);
    for (let i = 0; i < 200; i++) expect(proposeFor(flow)).toEqual(first);
    expect(flow.liked).toContain(first.proposed);
  });

  it("proposalsSeen does not move the winner, so a refresh mid-animation replays it", () => {
    expect(proposeFor({ ...flow, proposalsSeen: 5 })).toEqual(proposeFor({ ...flow, proposalsSeen: 0 }));
  });

  it("a redraw changes the seed inputs but never returns a removed face", () => {
    const first = proposeFor(flow).proposed!;
    const again = proposeFor({ ...flow, poolRemoved: [first], redraws: 1, proposed: first });
    expect(again.proposed).not.toBe(first);
    expect(flow.liked).toContain(again.proposed);
  });

  it("zero likes proposes the highest-dwell face", () => {
    const none = { ...flow, liked: [], dwell: { F03: 1000, F10: 12000, F16: 500 } };
    expect(proposeFor(none)).toMatchObject({ proposed: "F10", mode: "nolikes" });
  });
});

describe("Constellation faces", () => {
  const deckOrder = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
  const dwell = Object.fromEntries(deckOrder.map((id, i) => [id, (i + 1) * 100]));
  const base = { ...freshFlow("first", "choosing"), deckOrder, dwell };

  it("uses the liked faces, best dwell first, at most nine", () => {
    const faces = constellationFaces({ ...base, liked: deckOrder }, "L");
    expect(faces.length).toBe(9);
    expect(faces[0]).toBe("L");
    expect(faces).toEqual(["L", "K", "J", "I", "H", "G", "F", "E", "D"]);
  });

  it("with zero likes uses the top five by dwell", () => {
    expect(constellationFaces({ ...base, liked: [] }, "L")).toEqual(["L", "K", "J", "I", "H"]);
  });

  it("with exactly one like the ring is that one face", () => {
    expect(constellationFaces({ ...base, liked: ["C"] }, "C")).toEqual(["C"]);
  });

  it("always includes the winner, even when dwell would leave them out", () => {
    const faces = constellationFaces({ ...base, liked: deckOrder }, "A");
    expect(faces).toContain("A");
    expect(faces.length).toBe(9);
    expect(constellationFaces({ ...base, liked: [] }, "A")).toContain("A");
  });
});

describe("heartbeat synth", () => {
  const g = globalThis as unknown as { window?: unknown };
  const original = g.window;
  afterEach(() => {
    if (original === undefined) delete g.window;
    else g.window = original;
  });

  function stubContext(state: "running" | "suspended") {
    const created = { contexts: 0, oscillators: 0, closed: 0 };
    const node = () => ({ connect: (n: unknown) => n, gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } });
    class Ctx {
      state = state;
      currentTime = 0;
      destination = {};
      constructor() {
        created.contexts++;
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        created.closed++;
        return Promise.resolve();
      }
      createGain() {
        return node();
      }
      createBiquadFilter() {
        return { ...node(), frequency: { value: 0 }, type: "" };
      }
      createDelay() {
        return { ...node(), delayTime: { value: 0 } };
      }
      createOscillator() {
        created.oscillators++;
        return { ...node(), type: "", frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, start() {}, stop() {} };
      }
    }
    g.window = { AudioContext: Ctx };
    return created;
  }

  it("is null where Web Audio does not exist", () => {
    delete g.window;
    expect(createHeartbeat()).toBeNull();
    g.window = {};
    expect(createHeartbeat()).toBeNull();
  });

  it("a beat is a lub and a dub: two oscillators", () => {
    const created = stubContext("running");
    const synth = createHeartbeat()!;
    synth.beat();
    expect(created.oscillators).toBe(2);
  });

  it("the reveal is the glissando plus a three-note chord", () => {
    const created = stubContext("running");
    createHeartbeat()!.reveal();
    expect(created.oscillators).toBe(1 + 3);
  });

  it("the chord alone is three oscillators (reduced motion)", () => {
    const created = stubContext("running");
    createHeartbeat()!.chord();
    expect(created.oscillators).toBe(3);
  });

  it("a suspended context stays silent instead of throwing", () => {
    const created = stubContext("suspended");
    const synth = createHeartbeat()!;
    synth.beat();
    synth.reveal();
    synth.chord();
    expect(created.oscillators).toBe(0);
  });
});
