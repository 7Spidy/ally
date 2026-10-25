import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { compile, outputContract, type CompileCtx } from "@/lib/llm/compile";
import * as heart from "@/lib/heart";
import { isLive } from "@/lib/live";
import { CORE_MAP } from "@/lib/coreMap";
import { F01 } from "@/personas/persona";
import { F02, LIVE_TEMPLATES, PERSONAS, brainOf } from "@/personas/registry";
import { CORES } from "@/personas/cores";
import { questionCount } from "@/lib/llm/lint";
import { promptSnapshot } from "./iraSnapshotFixture";
import type { CoreId } from "@/state/schema";

const NEW_IDS = ["F03", "F04", "F05", "F07", "F08", "F09", "F11", "F13"];
const ALL_IDS = ["F01", "F02", ...NEW_IDS];

// Wall clock in IST, as UTC ms.
const ist = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 5.5 * 3600000;
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => heart.istNow(ist(y, mo, d, h, mi));
const mins = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};
const snap = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "__snapshots__", name), "utf8"));

describe("schema validity, all ten personas", () => {
  for (const id of ALL_IDS) {
    const p = PERSONAS[id];
    describe(id, () => {
      it("has every Persona key", () => {
        expect(Object.keys(p).sort()).toEqual(Object.keys(F01).sort());
        expect(p.id).toBe(id);
      });
      it("has matching table lengths of at least 7", () => {
        expect(p.weekday.length).toBe(p.engine.cards.length);
        expect(p.weekday.length).toBe(p.engine.blockStarts.length);
        expect(p.weekday.length).toBeGreaterThanOrEqual(7);
      });
      it("names real context cards", () => {
        const cards = Object.keys(p.contextCards);
        for (const c of [...p.engine.cards, ...Object.values(p.engine.specialCards), ...p.engine.cardOverrides.map((o) => o.card), "Morning", "Lunch", "Level-up"]) expect(cards, c).toContain(c);
      });
      it("has an energy entry for every presence", () => {
        for (const k of [...p.weekday.map((r) => r.presence), "Open", "Asleep"]) expect(Object.keys(p.engine.energy), k).toContain(k);
      });
      it("keys mood rules, gated moods and special cards by real moods", () => {
        const moods = p.moods.map((m) => m.mood);
        for (const k of [...p.engine.moodRules.map((r) => r.mood), ...Object.keys(p.engine.gatedMoods), ...Object.keys(p.engine.specialCards)]) expect(moods, k).toContain(k);
      });
      it("has 6 seasons, 12 arc beats, 7 week days and 6 levels", () => {
        expect(p.seasons).toHaveLength(6);
        expect(p.arc).toHaveLength(12);
        expect(p.week).toHaveLength(7);
        expect(p.levels).toHaveLength(6);
      });
      it("has golden tiers 1, 3 and 5 with one-bubble L1 replies of at most 200 chars", () => {
        expect(Object.keys(p.golden).sort()).toEqual(["1", "3", "5"]);
        for (const g of p.golden["1"]) expect(g.bubbles, g.user).toHaveLength(1);
        for (const t of ["1", "3", "5"] as const) for (const g of p.golden[t]) for (const b of g.bubbles) expect(b.length, b).toBeLessThanOrEqual(200);
      });
      it("keeps block times ascending, with the night ending after the last start", () => {
        const starts = p.engine.blockStarts.map(mins);
        for (let i = 1; i < starts.length; i++) expect(starts[i], `${id} row ${i}`).toBeGreaterThan(starts[i - 1]);
        expect(starts.length).toBeGreaterThanOrEqual(7);
        expect(mins(p.engine.nightEnd) + 1440).toBeGreaterThan(starts[starts.length - 1]);
      });
    });
  }
});

describe("the eight new files", () => {
  for (const id of NEW_IDS) {
    const p = PERSONAS[id];
    const raw = readFileSync(path.join(__dirname, "../../src/personas", `${id}.persona.json`), "utf8");
    it(`${id}: no em or en dashes`, () => {
      expect(raw).not.toMatch(/[—–]/);
    });
    it(`${id}: at most one question run per golden reply and per level line`, () => {
      for (const t of ["1", "3", "5"] as const) for (const g of p.golden[t]) expect(questionCount(g.bubbles), `${t}: ${g.user}`).toBeLessThanOrEqual(1);
      for (const l of p.levels) expect(questionCount([l.line]), `L${l.level}`).toBeLessThanOrEqual(1);
    });
    it(`${id}: every person appears in a hard rule with an introduction example`, () => {
      for (const name of p.engine.people) {
        const rule = p.engine.hardRules.find((r) => r.toLowerCase().includes(name.toLowerCase()));
        expect(rule, name).toBeTruthy();
        expect(rule, name).toMatch(/\("[^"]*"\)|\(\\?"[^)]*\)/);
      }
    });
  }
});

describe("core coherence", () => {
  for (const id of ALL_IDS) {
    it(`${id}: brain and secondary core match CORE_MAP`, () => {
      expect(brainOf(id)).toBe(CORE_MAP[id][0]);
      const second = CORE_MAP[id][1];
      const sc = PERSONAS[id].secondaryCore;
      const ok = sc === "none" || (second !== null && sc.startsWith(second)) || (id === "F01" && sc.includes("dormant"));
      expect(ok, sc).toBe(true);
    });
  }
  it("throws on an unknown template", () => {
    expect(() => brainOf("ZZ")).toThrow();
  });
});

describe("compile, the eight at levels 1 to 6", () => {
  const now = ist(2026, 5, 12, 10);
  const later = ist(2026, 5, 14, 22);
  const ctx = (p: (typeof PERSONAS)[string], level: number, t: number): CompileCtx => ({
    level,
    mode: "reply",
    userName: "Riya",
    heart: heart.now({ id: "c_x", createdAt: t - 40 * 86400000 }, t, p),
    milestone: null,
    facts: [],
    weekSummaries: [],
    daySummaries: [],
    history: [{ id: 5, who: "me", text: "hello" }],
    coolOff: false,
    safetyMode: false,
    lowEffort: false,
    persona: p,
  });
  const ROMANTIC_EMOJI = "Romantic emoji (❤️ 😘 💋 🥰 😍) are fine";
  for (const id of NEW_IDS) {
    const p = PERSONAS[id];
    const brain = brainOf(id);
    for (const level of [1, 2, 3, 4, 5, 6]) {
      it(`${id} L${level}`, () => {
        const c = compile(ctx(p, level, now));
        expect(c.system).toContain(`CORE (${CORES[brain].name})`);
        for (const r of CORES[brain].rules) expect(c.system).toContain(r);
        for (const l of p.levels) if (l.level !== level && l.line !== p.levels[level - 1].line) expect(c.system, `line of L${l.level}`).not.toContain(l.line);
        if (level >= 5) expect(c.system).toContain(p.l6Line);
        else expect(c.system).not.toContain(p.l6Line);
        const contract = outputContract(level, p);
        if (level >= CORES[brain].romanticEmojiFrom) expect(contract).toContain(ROMANTIC_EMOJI);
        else expect(contract).toContain("No romantic emoji yet");
        if (id === "F11" || id === "F13") expect(c.system).toContain("SEBI-registered");
        if (id === "F08") expect(c.system).toContain("no calorie, macro or weight targets");
        expect(compile(ctx(p, level, later)).stablePrefix).toBe(c.stablePrefix);
      });
    }
  }
  it("the romantic-emoji gate is L3 for ROMANTIC and L5 for the rest", () => {
    const expected: Record<CoreId, number> = { ROMANTIC: 3, PSYCH: 5, TRAINER: 5, MONEY: 5, FRIEND: 5 };
    for (const k of Object.keys(expected) as CoreId[]) expect(CORES[k].romanticEmojiFrom).toBe(expected[k]);
  });
});

describe("regression gates (step 0 snapshots)", () => {
  it("Noor's prompt equals noor-prompt.json byte for byte at L1, L3, L5, L6", () => {
    expect(JSON.parse(JSON.stringify(promptSnapshot(F02)))).toEqual(snap("noor-prompt.json"));
  });
  it("F01 and F02 timeBlock output equals heart-blocks-f01-f02.json for all 672 slots", () => {
    const expected = snap("heart-blocks-f01-f02.json") as Record<string, unknown[]>;
    const mon = Date.UTC(2026, 4, 11) - 5.5 * 3600000;
    for (const [id, persona] of [["F01", F01], ["F02", F02]] as const) {
      expect(expected[id]).toHaveLength(672);
      for (let i = 0; i < 672; i++) {
        const { row, presence, activity, card } = heart.timeBlock(heart.istNow(mon + i * 15 * 60000), persona);
        expect({ row, presence, activity, card }, `${id} slot ${i}`).toEqual(expected[id][i]);
      }
    }
  });
});

describe("Zoya's clock (F05, Wednesday)", () => {
  const F05 = PERSONAS.F05;
  it("runs past midnight", () => {
    expect(heart.timeBlock(at(2026, 5, 13, 2, 0), F05).presence).toBe("After hours");
    expect(heart.timeBlock(at(2026, 5, 13, 4, 0), F05).presence).toBe("Asleep");
    expect(heart.timeBlock(at(2026, 5, 13, 12, 0), F05).presence).toBe("Waking up");
    expect(heart.timeBlock(at(2026, 5, 13, 21, 0), F05).presence).toBe("Mixing the show");
    expect(heart.timeBlock(at(2026, 5, 13, 0, 45), F05).presence).toBe("Load-out");
  });
  it("shows card Dark night on Monday at 17:00", () => {
    expect(heart.timeBlock(at(2026, 5, 11, 17, 0), F05).card).toBe("Dark night");
  });
});

describe("isLive", () => {
  const c = (templateId: string, primary: CoreId | null) => ({ templateId, core: { primary } });
  it("each of the eight is live for a qa owner with a matching primary, and not for a normal owner", () => {
    for (const id of NEW_IDS) {
      expect((LIVE_TEMPLATES as Record<string, string>)[id]).toBe("qa");
      expect(isLive(c(id, brainOf(id)), true), id).toBe(true);
      expect(isLive(c(id, brainOf(id)), false), id).toBe(false);
    }
  });
  it("a mismatched primary is never live", () => {
    expect(isLive(c("F03", "TRAINER"), true)).toBe(false);
    expect(isLive(c("F13", "FRIEND"), true)).toBe(false);
    expect(isLive(c("F04", "ROMANTIC"), true)).toBe(false);
  });
  it("F01 and F02 behave as before", () => {
    expect(isLive(c("F01", "ROMANTIC"), false)).toBe(true);
    expect(isLive(c("F02", "ROMANTIC"), false)).toBe(false);
    expect(isLive(c("F02", "ROMANTIC"), true)).toBe(true);
    expect(isLive(c("F02", "PSYCH"), true)).toBe(false);
  });
});
