// Ported from ally-onboarding.test.js (node --test) into Vitest, importing
// src/lib/engine.ts directly instead of vm-extracting the HTML build.
// Tests 1-15 port verbatim. Test 16 keeps only the pure ageAt() assertions
// (applyGate/initialState/S.blocked are gate-application logic that lives in
// route/component code in this architecture, not in src/lib — see note at
// bottom of file). Tests 17, 18 and 20 are SKIPPED here for the same reason
// (see notes). Test 19 is adapted to the new architecture: "locked" no
// longer exists as a state field — becoming a Companion is the equivalent
// event, produced only by the reducer's CONFIRM_LOCK action. Test 9 is
// rewritten per the updated spec (pool sizes 16/15/14/1). Tests 39-43 are
// new (round two / add-card / no-companion-without-confirm).
import { describe, it, expect } from "vitest";
import {
  CORES,
  INTEREST_TAGS,
  DISCLOSURE_STOPS,
  STRUCTURE_STOPS,
  PRESSURES,
  scoreCores,
  assignCore,
  computeCore,
  deckTemplates,
  orderDeck,
  overlap,
  propose,
  dwellWeight,
  addDwell,
  ageAt,
  type Template,
} from "@/lib/engine";
import { allyReducer } from "@/state/allyReducer";
import { freshFlow, freshState, emptyAnswers, type Answers, type Core, type Gender } from "@/state/schema";
import { COPY } from "@/lib/copy";
import { pool as selectorPool } from "@/lib/selectors";
import { applyGate } from "@/lib/gate";
import { BLOCK_DAYS, MAX_COMPANIONS } from "@/lib/config";
import { isBlocked, BLOCK_KEY } from "@/lib/migrate";
import { addCardState, genderPanelInert } from "@/lib/addCard";
import { invalidationFor } from "../../app/onboarding/_lib/invalidate";
import manifest from "../../public/assets/manifest.json";

const templates = manifest.templates as unknown as Template[];

// ---- helpers (ported) ----
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomAnswers(): Answers {
  const q11: string[] = [];
  const tags = [...INTEREST_TAGS];
  const n = Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) q11.push(tags.splice(Math.floor(Math.random() * tags.length), 1)[0]);
  return {
    q5: pick(DISCLOSURE_STOPS),
    q6: Math.random(),
    q7: Math.random(),
    q8: pick(STRUCTURE_STOPS),
    q9: Math.random(),
    q10: pick(PRESSURES),
    q11,
  };
}

function answersForCore(c: (typeof CORES)[number], q10: (typeof PRESSURES)[number] | null = c.owns): Answers {
  return { q5: c.disclosure, q6: c.warmth, q7: c.push, q8: c.structure, q9: c.nostalgia, q10, q11: [] };
}

function subsets<T>(arr: readonly T[], maxSize: number): T[][] {
  const out: T[][] = [[]];
  for (let size = 1; size <= maxSize; size++) {
    const rec = (start: number, cur: T[]) => {
      if (cur.length === size) {
        out.push([...cur]);
        return;
      }
      for (let i = start; i < arr.length; i++) rec(i + 1, [...cur, arr[i]]);
    };
    rec(0, []);
  }
  return out;
}

const isoDaysAgo = (years: number, extraDays: number, base = new Date()): string => {
  const d = new Date(base.getFullYear() - years, base.getMonth(), base.getDate() + extraDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// =====================================================================
// Matching
// =====================================================================
describe("Matching", () => {
  it("1. identical answers produce an identical core across 100 runs", () => {
    const a = randomAnswers();
    const first = computeCore(a);
    for (let i = 0; i < 100; i++) {
      expect(computeCore(a)).toEqual(first);
    }
  });

  it("2. every one of the six cores is reachable by some answer combination", () => {
    const reached = new Set<string>();
    for (const c of CORES) reached.add(computeCore(answersForCore(c)).primary);
    expect([...reached].sort()).toEqual(CORES.map((c) => c.id).sort());
  });

  it("3. a user whose vector exactly matches a core scores that core first", () => {
    for (const c of CORES) {
      expect(scoreCores(answersForCore(c))[0].id).toBe(c.id);
      expect(scoreCores(answersForCore(c, null))[0].id).toBe(c.id);
    }
  });

  it("4. the pressure boost is exactly 1.15x and applies to exactly one core", () => {
    for (let run = 0; run < 200; run++) {
      const a = randomAnswers();
      const boosted = new Map(scoreCores(a).map((r) => [r.id, r.score]));
      const plain = new Map(scoreCores({ ...a, q10: null }).map((r) => [r.id, r.score]));
      const changed = [...boosted.keys()].filter((id) => boosted.get(id) !== plain.get(id));
      expect(changed.length, `exactly one core changed for q10=${a.q10}`).toBe(1);
      const id = changed[0];
      expect(CORES.find((c) => c.id === id)!.owns).toBe(a.q10);
      expect(Math.abs(boosted.get(id)! - plain.get(id)! * 1.15)).toBeLessThan(0.0002);
    }
  });

  it("5. top-two gap below 0.06 produces a blend with weight 70", () => {
    let found = 0;
    for (let i = 0; i < 20000 && found < 25; i++) {
      const ranked = scoreCores(randomAnswers());
      if (ranked[0].score - ranked[1].score < 0.06) {
        const r = assignCore(ranked);
        expect(r.weight).toBe(70);
        expect(r.primary).toBe(ranked[0].id);
        expect(r.secondary).not.toBeNull();
        expect(r.secondary).not.toBe(r.primary);
        found++;
      }
    }
    expect(found, "found near-tie vectors").toBeGreaterThan(0);
  });

  it("6. top-two gap of 0.06 or above gives secondary null and weight 100", () => {
    let found = 0;
    for (let i = 0; i < 20000 && found < 25; i++) {
      const ranked = scoreCores(randomAnswers());
      if (ranked[0].score - ranked[1].score >= 0.06) {
        const r = assignCore(ranked);
        expect(r.weight).toBe(100);
        expect(r.secondary).toBeNull();
        expect(r.primary).toBe(ranked[0].id);
        found++;
      }
    }
    expect(found, "found clear-gap vectors").toBeGreaterThan(0);
    const r = assignCore([
      { id: "KIAAN", score: 0.8 },
      { id: "MEHER", score: 0.74 },
      { id: "ANANYA", score: 0.5 },
    ]);
    expect(r).toEqual({ primary: "KIAAN", secondary: null, weight: 100 });
  });

  it("7. KIAAN is never secondary across a 10,000-run random sweep", () => {
    for (let i = 0; i < 10000; i++) {
      const r = computeCore(randomAnswers());
      expect(r.secondary).not.toBe("KIAAN");
    }
    const r = assignCore([
      { id: "PRIYA", score: 0.9 },
      { id: "KIAAN", score: 0.89 },
      { id: "ANAY", score: 0.7 },
    ]);
    expect(r.secondary).toBe("ANAY");
  });

  it("8. Q11 interests do not change the assigned core", () => {
    for (let run = 0; run < 20; run++) {
      const base = randomAnswers();
      const perms = subsets(INTEREST_TAGS, 3);
      expect(perms.length).toBe(93);
      const cores = new Set(
        perms.map((q11) => {
          const r = computeCore({ ...base, q11 });
          return `${r.primary}/${r.secondary}/${r.weight}`;
        })
      );
      expect(cores.size).toBe(1);
    }
  });
});

// =====================================================================
// Deck
// =====================================================================
describe("Deck", () => {
  it("9. orderDeck/pool composition is correct for pool sizes 16, 15, 14 and 1", () => {
    for (const gender of ["woman", "man"] as Gender[]) {
      const full = deckTemplates(templates, gender);
      expect(full.length).toBe(16);

      const excludeCounts = [0, 1, 2, 15];
      for (const nExclude of excludeCounts) {
        const excluded = new Set(full.slice(0, nExclude).map((t) => t.id));
        const set = deckTemplates(templates, gender, excluded);
        const expectedSize = 16 - nExclude;
        expect(set.length).toBe(expectedSize);

        for (let run = 0; run < 20; run++) {
          const user = {
            region: pick(["North", "West", "East", "Northeast", "Central", "South", "Outside India", "Unspecified"]),
            age: 18 + Math.floor(Math.random() * 25),
            interests: randomAnswers().q11,
          };
          const out = orderDeck(set, user);
          expect(out.length).toBe(expectedSize);
          expect(out.every((t) => t.gender === gender)).toBe(true);
          expect(new Set(out.map((t) => t.id)).size).toBe(expectedSize);
          expect(out.map((t) => t.id).sort()).toEqual(set.map((t) => t.id).sort());
          expect(out.some((t) => excluded.has(t.id))).toBe(false);
        }
      }
    }
  });

  it("10. over 500 runs with identical input, at least two distinct orderings appear", () => {
    const set = deckTemplates(templates, "woman");
    const user = { region: "West", age: 24, interests: ["making", "screen"] };
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(orderDeck(set, user).map((t) => t.id).join(","));
    expect(seen.size, `distinct orderings: ${seen.size}`).toBeGreaterThanOrEqual(2);
  });

  it("11. overlap returns 0 for an empty pick array and 1 when every pick is matched", () => {
    expect(overlap(["music", "food"], [])).toBe(0);
    expect(overlap(["music", "food"], null)).toBe(0);
    expect(overlap(["music", "food"], undefined)).toBe(0);
    expect(overlap(["music", "food"], ["music", "food"])).toBe(1);
    expect(overlap(["music", "food", "people"], ["food"])).toBe(1);
    expect(overlap(["music"], ["music", "food"])).toBe(0.5);
    expect(overlap([], ["music"])).toBe(0);
  });

  it("12. propose only ever returns a member of the pool", () => {
    for (let run = 0; run < 2000; run++) {
      const n = 1 + Math.floor(Math.random() * 8);
      const p = Array.from({ length: n }, (_, i) => `T${i}`);
      const dwell = Object.fromEntries(p.map((id) => [id, Math.random() * 20000]));
      expect(p.includes(propose(p, dwell)!)).toBe(true);
    }
    expect(["A", "B"].includes(propose(["A", "B"], {})!)).toBe(true);
  });

  it("13. propose never returns null when the pool is non-empty", () => {
    for (let run = 0; run < 2000; run++) {
      const p = ["A", "B", "C"].slice(0, 1 + Math.floor(Math.random() * 3));
      expect(propose(p, { A: 0, B: 15000, C: 999999 })).not.toBeNull();
    }
    expect(propose([], {})).toBeNull();
  });

  it("14. over 5,000 runs a 12,000ms card beats a 2,000ms card and the 2,000ms card still appears", () => {
    const counts: Record<string, number> = { hi: 0, lo: 0 };
    for (let i = 0; i < 5000; i++) counts[propose(["hi", "lo"], { hi: 12000, lo: 2000 })!]++;
    expect(counts.hi, `hi=${counts.hi} lo=${counts.lo}`).toBeGreaterThan(counts.lo);
    expect(counts.lo, `lo proposed ${counts.lo} times`).toBeGreaterThanOrEqual(1);
  });

  it("15. dwell above 15,000ms is capped", () => {
    expect(dwellWeight(15000)).toBe(dwellWeight(99999999));
    expect(dwellWeight(15000)).toBe(dwellWeight(15001));
    expect(dwellWeight(14999)).toBeLessThan(dwellWeight(15000));
    let d: Record<string, number> = {};
    for (let i = 0; i < 40; i++) d = addDwell(d, "X", 1000);
    expect(d.X).toBe(15000);
    let a = 0,
      b = 0;
    for (let i = 0; i < 6000; i++) (propose(["a", "b"], { a: 15000, b: 50000 }) === "a" ? a++ : b++);
    expect(Math.abs(a - b), `a=${a} b=${b}`).toBeLessThan(400);
  });
});

// =====================================================================
// Gate
// =====================================================================
describe("Gate", () => {
  it("16. DOB exactly 18 years ago today passes; one day later fails (pure ageAt)", () => {
    const today = new Date();
    const exactly18 = isoDaysAgo(18, 0, today);
    const oneDayShort = isoDaysAgo(18, 1, today);
    expect(ageAt(exactly18, today)).toBe(18);
    expect(ageAt(oneDayShort, today)).toBe(17);
    // fixed-date checks independent of the clock
    expect(ageAt("2008-09-14", new Date(2026, 8, 14))).toBe(18);
    expect(ageAt("2008-09-15", new Date(2026, 8, 14))).toBe(17);
    expect(ageAt("2008-02-29", new Date(2026, 1, 28))).toBe(17);
    expect(ageAt("2008-02-29", new Date(2026, 2, 1))).toBe(18);
  });

  it("17. failing the gate leaves no DOB in the persisted state", () => {
    // applyGate() is what app/onboarding/birthday/page.tsx calls; on a fail
    // it returns dob:null/age:null for the caller to persist (never the
    // entered DOB), plus a blockedUntil for the caller to write to storage.
    const nowMs = new Date(2026, 8, 14).getTime();
    const under18 = applyGate("2010-01-01", nowMs); // 16 on 2026-09-14
    expect(under18.blocked).toBe(true);
    expect(under18.dob).toBeNull();
    expect(under18.age).toBeNull();
    expect(under18.blockedUntil).toBe(nowMs + BLOCK_DAYS * 86400000);

    const over18 = applyGate("2008-01-01", nowMs); // 18
    expect(over18.blocked).toBe(false);
    expect(over18.dob).toBe("2008-01-01");
    expect(over18.age).toBe(18);
    expect(over18.blockedUntil).toBeNull();
  });

  it("18. a future ally_blocked_until short-circuits to the blocked screen on boot", () => {
    // isBlocked/BLOCK_KEY (src/lib/migrate.ts) is what app/page.tsx checks
    // before ever computing bootTarget(); confirm the future/past boundary.
    const storage = { getItem: (k: string) => (k === BLOCK_KEY ? String(2_000_000_000_000) : null), setItem: () => {} };
    expect(isBlocked(storage, 1_000_000_000_000)).toBe(true);
    expect(isBlocked(storage, 2_000_000_000_001)).toBe(false);
  });
});

// =====================================================================
// Flow
// =====================================================================
describe("Flow", () => {
  it("19. no reducer path creates a Companion without the explicit CONFIRM_LOCK action", () => {
    // Static: CONFIRM_LOCK is the only case in allyReducer.ts that appends to
    // `companions` from a flow (DEBUG_SEED_COMPANION also appends, but only
    // from an explicit debug-panel action carrying a fully-formed Companion,
    // never built from `locked`/flow state).
    const src = require("fs").readFileSync(require("path").join(__dirname, "../../src/state/allyReducer.ts"), "utf8") as string;
    const caseBlocks = [...src.matchAll(/case "([A-Z_]+)":([\s\S]*?)(?=\n {4}case "|\n {4}default:)/g)];
    const appendsCompanions = caseBlocks.filter(([, , body]) => /companions:\s*\[\.\.\.state\.companions/.test(body));
    expect(appendsCompanions.map(([, name]) => name).sort()).toEqual(["CONFIRM_LOCK", "DEBUG_SEED_COMPANION"]);

    // The confirm button copy is unchanged from spec §5.
    expect(COPY.confirm.primary).toBe("Yes, it's them");

    // Behavioural: drive the reducer with random flow-mutating actions and
    // confirm `companions` only grows on an explicit CONFIRM_LOCK.
    let state = freshState(Date.now(), "2026-01-01");
    for (let i = 0; i < 500; i++) {
      const a = randomAnswers();
      state = allyReducer(state, { type: "SET_ANSWER", key: "q6", value: a.q6 });
      state = allyReducer(state, { type: "COMPUTE_CORE" });
      state = allyReducer(state, { type: "SET_GENDER", gender: pick(["woman", "man"]) });
      state = allyReducer(state, { type: "DECK_INIT", deckOrder: ["F01", "F02", "F03"] });
      state = allyReducer(state, { type: "DECK_LIKE", id: "F01" });
      state = allyReducer(state, { type: "PROPOSE", result: { proposed: "F01", canRedraw: true, mode: "pool" } });
      expect(state.companions.length).toBe(0);
    }
    const locked = allyReducer(state, { type: "CONFIRM_LOCK", templateId: "F01", now: Date.now() });
    expect(locked.companions.length).toBe(1);
    expect(locked.companions[0].templateId).toBe("F01");
    expect(locked.flow).toBeNull();
  });

  it("20. changing Q2 (gender) clears liked, dwell and proposed", () => {
    // invalidationFor() is the pure rule table app/onboarding/**'s pages
    // call before dispatching INVALIDATE; it lives beside those pages
    // (app/onboarding/_lib/invalidate.ts) rather than in src/lib since it
    // operates on OnboardingFlow-shape decisions specific to those routes,
    // but it has no DOM/React import so it's safely importable here too.
    const flow = { ...freshFlow("first", "deck"), liked: ["F01", "F02"], dwell: { F01: 4000 }, proposed: "F01" };
    const { patch, changed } = invalidationFor("gender", flow);
    expect(changed).toBe(true);
    expect(patch).toMatchObject({ liked: [], dwell: {}, proposed: null });
  });
});

// =====================================================================
// Round two / add-card (39-43)
// =====================================================================
describe("Round two", () => {
  it("39. same answers across two rounds yield the same core (duplicates allowed by design)", () => {
    const a = randomAnswers();
    const round1 = computeCore(a);
    const round2 = computeCore(a);
    expect(round2).toEqual(round1);
  });

  it("40. the deck never contains an active or parted template, across 1,000 randomised states", () => {
    const allIds = templates.map((t) => t.id);
    for (let i = 0; i < 1000; i++) {
      const gender: Gender = pick(["woman", "man"]);
      const genderIds = templates.filter((t) => t.gender === gender).map((t) => t.id);
      const excludedCount = Math.floor(Math.random() * genderIds.length);
      const shuffled = [...genderIds].sort(() => Math.random() - 0.5);
      const partedIds = shuffled.slice(0, Math.floor(excludedCount / 2));
      const activeIds = shuffled.slice(Math.floor(excludedCount / 2), excludedCount);

      let state = freshState(Date.now(), "2026-01-01");
      state = {
        ...state,
        ledger: { ...state.ledger, parted: partedIds },
        companions: activeIds.map((templateId, idx) => ({
          id: `c_${idx}`,
          templateId,
          deckGender: gender,
          answers: emptyAnswers(),
          core: { primary: null, secondary: null, weight: null, ranked: [] },
          createdAt: 0,
          lastOpenedAt: 0,
          status: "active" as const,
          partedAt: null,
          purgeAt: null,
          messages: [],
          exchanges: 0,
          unread: 0,
          notify: true,
          sound: true,
        })),
      };
      const deck = selectorPool(state, templates, gender);
      for (const t of deck) {
        expect(partedIds.includes(t.id)).toBe(false);
        expect(activeIds.includes(t.id)).toBe(false);
      }
      expect(deck.length).toBe(genderIds.length - new Set([...partedIds, ...activeIds]).size);
      void allIds;
    }
  });

  it("41. add-card state follows §8.4 across active-count x pool-emptiness", () => {
    // addCardState() (src/lib/addCard.ts) is the pure rule home/page.tsx
    // evaluates in order: cap first, then exhausted, then add.
    for (let activeCount = 0; activeCount <= MAX_COMPANIONS; activeCount++) {
      for (const bothPoolsEmpty of [false, true]) {
        const kind = addCardState(activeCount, bothPoolsEmpty);
        if (activeCount === MAX_COMPANIONS) expect(kind).toBe("cap");
        else if (bothPoolsEmpty) expect(kind).toBe("exhausted");
        else expect(kind).toBe("add");
      }
    }
  });

  it("42. a gender panel with an empty pool is inert and unselectable", () => {
    // genderPanelInert() (src/lib/addCard.ts) drives both the disabled attribute
    // and choose()'s early return in app/onboarding/gender/page.tsx.
    expect(genderPanelInert(true, 0)).toBe(true);
    for (const size of [1, 2, 15, 16]) expect(genderPanelInert(true, size)).toBe(false);
    // First run never disables a panel, whatever the pool.
    expect(genderPanelInert(false, 0)).toBe(false);
  });

  it("43. CONFIRM_LOCK is the only allyReducer case that appends to companions from flow state", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../../src/state/allyReducer.ts"), "utf8") as string;
    const caseBlocks = [...src.matchAll(/case "([A-Z_]+)":([\s\S]*?)(?=\n {4}case "|\n {4}default:)/g)];
    const appendsCompanions = caseBlocks.filter(([, , body]) => /companions:\s*\[\.\.\.state\.companions/.test(body));
    // DEBUG_SEED_COMPANION is a debug-panel-only escape hatch taking a
    // pre-built Companion, not derived from onboarding flow state.
    const fromFlow = appendsCompanions.filter(([, name]) => name !== "DEBUG_SEED_COMPANION");
    expect(fromFlow.map(([, name]) => name)).toEqual(["CONFIRM_LOCK"]);
  });
});
