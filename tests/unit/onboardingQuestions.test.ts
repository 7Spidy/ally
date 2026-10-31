// v3.1: the five style questions. Each question has one option per support
// style, positions rotated, and the pressure answer splits MONEY from TRAINER.
import { describe, it, expect } from "vitest";
import { PRESSURES, PRESSURE_SCORE, SCORE, assignCore, computeCore, needsTiebreak, scoreCores } from "@/lib/engine";
import { emptyAnswers, type Answers, type CoreId } from "@/state/schema";

const QS = ["q5", "q6", "q7", "q8", "q9"] as const;
const OPTIONS = [0, 1, 2, 3];
const CORES: CoreId[] = ["ROMANTIC", "PSYCH", "MONEY", "TRAINER", "FRIEND"];

function answers(over: Partial<Answers> = {}): Answers {
  return { ...emptyAnswers(), ...over };
}

function* everyAnswerSet(): Generator<Answers> {
  for (const q5 of OPTIONS) for (const q6 of OPTIONS) for (const q7 of OPTIONS) for (const q8 of OPTIONS) for (const q9 of OPTIONS)
    for (const q10 of PRESSURES) yield { q5, q6, q7, q8, q9, q10, q11: [], tb: null };
}

/** The core(s) an option leads with, as a sorted key. */
function lead(opt: Partial<Record<CoreId, number>>): string {
  const max = Math.max(...Object.values(opt));
  return (Object.entries(opt) as [CoreId, number][]).filter(([, v]) => v === max).map(([k]) => k).sort().join("+");
}

describe("question structure", () => {
  it("each of q5..q9 has one ROMANTIC, one PSYCH, one FRIEND and one MONEY+TRAINER lead", () => {
    for (const q of QS) {
      expect(SCORE[q].map(lead).sort(), q).toEqual(["FRIEND", "MONEY+TRAINER", "PSYCH", "ROMANTIC"]);
    }
  });

  it("no style sits at the same index in more than 2 of the 5 questions", () => {
    for (const style of ["ROMANTIC", "PSYCH", "FRIEND", "MONEY+TRAINER"]) {
      const counts = [0, 0, 0, 0];
      for (const q of QS) counts[SCORE[q].map(lead).indexOf(style)]++;
      expect(Math.max(...counts), style).toBeLessThanOrEqual(2);
    }
  });
});

describe("signature answer sets", () => {
  const sig: [number[], Answers["q10"], CoreId | "TIEBREAK"][] = [
    [[0, 3, 1, 2, 0], "alone", "ROMANTIC"],
    [[1, 0, 2, 3, 2], "head", "PSYCH"],
    [[2, 1, 3, 0, 1], "notgood", "FRIEND"],
    [[3, 2, 0, 1, 3], "money", "MONEY"],
    [[3, 2, 0, 1, 3], "health", "TRAINER"],
    [[3, 2, 0, 1, 3], "alone", "TIEBREAK"],
  ];
  for (const [[q5, q6, q7, q8, q9], q10, want] of sig) {
    it(`${[q5, q6, q7, q8, q9].join("")} + ${q10} -> ${want}`, () => {
      const a = answers({ q5, q6, q7, q8, q9, q10 });
      const ranked = scoreCores(a);
      const pair = needsTiebreak(ranked, a);
      if (want === "TIEBREAK") {
        expect(pair?.slice().sort()).toEqual(["MONEY", "TRAINER"]);
      } else {
        expect(pair).toBeNull();
        expect(computeCore(a).primary).toBe(want);
      }
    });
  }
});

describe("assignCore over every answer set", () => {
  it("MONEY and TRAINER never support each other; ROMANTIC never supports", () => {
    for (const a of everyAnswerSet()) {
      const { primary, secondary } = assignCore(scoreCores(a));
      if (primary === "MONEY") expect(secondary).not.toBe("TRAINER");
      if (primary === "TRAINER") expect(secondary).not.toBe("MONEY");
      expect(secondary).not.toBe("ROMANTIC");
    }
  });

  it("straight-lining a card position gives TRAINER at most once across the six pressures", () => {
    for (const pos of OPTIONS) {
      let trainer = 0;
      for (const q10 of PRESSURES) {
        if (computeCore(answers({ q5: pos, q6: pos, q7: pos, q8: pos, q9: pos, q10 })).primary === "TRAINER") trainer++;
      }
      expect(trainer, `position ${pos}`).toBeLessThanOrEqual(1);
    }
  });

  it("money pressure never gives TRAINER primary and health never gives MONEY primary", () => {
    for (const a of everyAnswerSet()) {
      if (a.q10 === "money") expect(computeCore(a).primary).not.toBe("TRAINER");
      if (a.q10 === "health") expect(computeCore(a).primary).not.toBe("MONEY");
    }
  });

  it("every core is primary for at least 6% of the 6,144 sets", () => {
    const counts = new Map<CoreId, number>();
    let n = 0;
    for (const a of everyAnswerSet()) {
      n++;
      const p = computeCore(a).primary!;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    expect(n).toBe(6144);
    for (const id of CORES) expect((counts.get(id) ?? 0) / n, id).toBeGreaterThanOrEqual(0.06);
  });

  it("PRESSURE_SCORE covers every pressure", () => {
    for (const p of PRESSURES) expect(Object.keys(PRESSURE_SCORE[p]).length).toBeGreaterThan(0);
  });
});
