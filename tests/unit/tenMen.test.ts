import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { compile, outputContract, type CompileCtx } from "@/lib/llm/compile";
import * as heart from "@/lib/heart";
import { isLive } from "@/lib/live";
import { CORE_MAP } from "@/lib/coreMap";
import { F01 } from "@/personas/persona";
import { LIVE_TEMPLATES, PERSONAS, brainOf, personaFor } from "@/personas/registry";
import { CORES, coreDef } from "@/personas/cores";
import { pronounsFor } from "@/personas/pronouns";
import { questionCount } from "@/lib/llm/lint";
import { promptSnapshot } from "./iraSnapshotFixture";
import type { CoreId } from "@/state/schema";

const MEN = ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10"];
const WOMEN = ["F01", "F02", "F03", "F04", "F05", "F07", "F08", "F09", "F11", "F13"];

// Wall clock in IST, as UTC ms.
const ist = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 5.5 * 3600000;
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => heart.istNow(ist(y, mo, d, h, mi));
const mins = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

describe("schema validity, the ten men", () => {
  for (const id of MEN) {
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
        expect(mins(p.engine.nightEnd) + 1440).toBeGreaterThan(starts[starts.length - 1]);
      });
      it("has no em or en dashes in the file", () => {
        expect(readFileSync(path.join(__dirname, "../../src/personas", `${id}.persona.json`), "utf8")).not.toMatch(/[—–]/);
      });
      it("has at most one question run per golden reply and per level line", () => {
        for (const t of ["1", "3", "5"] as const) for (const g of p.golden[t]) expect(questionCount(g.bubbles), `${t}: ${g.user}`).toBeLessThanOrEqual(1);
        for (const l of p.levels) expect(questionCount([l.line]), `L${l.level}`).toBeLessThanOrEqual(1);
      });
      it("introduces every person in a hard rule with an example", () => {
        for (const name of p.engine.people) {
          const rule = p.engine.hardRules.find((r) => r.toLowerCase().includes(name.toLowerCase()));
          expect(rule, name).toBeTruthy();
          expect(rule, name).toMatch(/\("[^"]*"\)|\(\\?"[^)]*\)/);
        }
      });
    });
  }
});

describe("core coherence", () => {
  for (const id of MEN) {
    it(`${id}: brain and secondary core match CORE_MAP`, () => {
      expect(brainOf(id)).toBe(CORE_MAP[id][0]);
      const second = CORE_MAP[id][1];
      const sc = PERSONAS[id].secondaryCore;
      expect(sc === "none" || (second !== null && sc.startsWith(second)), sc).toBe(true);
    });
  }
});

describe("compile, the ten men at levels 1 to 6", () => {
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
  const FEM = /\b(she|her|hers|herself)\b/i;
  for (const id of MEN) {
    const p = PERSONAS[id];
    const brain = brainOf(id);
    const def = coreDef(brain, p);
    for (const level of [1, 2, 3, 4, 5, 6]) {
      it(`${id} L${level}`, () => {
        const c = compile(ctx(p, level, now));
        expect(c.system).toContain(`CORE (${def.name})`);
        for (const r of def.rules) expect(c.system).toContain(r);
        for (const l of p.levels) if (l.level !== level && l.line !== p.levels[level - 1].line) expect(c.system, `line of L${l.level}`).not.toContain(l.line);
        if (level >= 5) expect(c.system).toContain(p.l6Line);
        else expect(c.system).not.toContain(p.l6Line);
        const contract = outputContract(level, p);
        if (level >= def.romanticEmojiFrom) expect(contract).toContain(ROMANTIC_EMOJI);
        else expect(contract).toContain("No romantic emoji yet");
        expect(def.romanticEmojiFrom).toBe(brain === "ROMANTIC" ? 3 : 5);
        expect(compile(ctx(p, level, later)).stablePrefix).toBe(c.stablePrefix);
        // Pronouns: no feminine pronoun outside the Family line.
        for (const text of [c.system, c.volatile]) {
          for (const line of text.split("\n")) {
            if (line.startsWith("Family:")) continue;
            expect(line, `${id} L${level}`).not.toMatch(FEM);
          }
        }
      });
    }
  }
  it("the localized core text uses he, him and his for men", () => {
    const c = compile(ctx(PERSONAS.M01, 3, now));
    expect(c.system).toContain("Initiative: he leads as often as he follows.");
    expect(compile(ctx(PERSONAS.M01, 1, now)).volatile).toContain("taking up a lot of his attention");
  });
  it("guardrails reach the prompt", () => {
    const sys = (id: string) => compile(ctx(PERSONAS[id], 3, now)).system;
    expect(sys("M06")).toContain("SEBI-registered");
    for (const id of ["M08", "M09"]) expect(sys(id)).toContain("no calorie, macro or weight targets");
    for (const id of ["M01", "M02", "M05"]) expect(sys(id)).toContain("never say buy, sell or hold");
  });
});

describe("pronouns", () => {
  it("M-ids get he, him, his; everything else she, her, her", () => {
    expect(pronounsFor({ id: "M07" })).toEqual({ sub: "he", obj: "him", pos: "his", Pos: "His", Sub: "He" });
    expect(pronounsFor({ id: "F03" })).toEqual({ sub: "she", obj: "her", pos: "her", Pos: "Her", Sub: "She" });
  });
  it("CORES stays the feminine default", () => {
    for (const k of Object.keys(CORES) as CoreId[]) expect(coreDef(k, { id: "F01" })).toEqual(CORES[k]);
    expect(CORES.TRAINER.warmth).toContain("Accountability is how she cares");
  });
  it("the women's compiled prompts equal women-prompts-before.json byte for byte", () => {
    const expected = JSON.parse(readFileSync(path.join(__dirname, "__snapshots__", "women-prompts-before.json"), "utf8"));
    for (const id of WOMEN) expect(JSON.parse(JSON.stringify(promptSnapshot(PERSONAS[id]))), id).toEqual(expected[id]);
  });
});

describe("address terms", () => {
  const ADDRESS = /\b(bhai|bro|bhaiya|dada|daju|bawa|macha|bruh|dude|beta|sir|didi|sis)\b/i;
  for (const id of MEN) {
    it(`${id}: no gendered address term in replies, level lines, moods or playbook`, () => {
      const p = PERSONAS[id];
      const lines: string[] = [];
      for (const t of ["1", "3", "5"] as const) for (const g of p.golden[t]) lines.push(...g.bubbles);
      lines.push(...p.levels.map((l) => l.line), p.l6Line, ...p.moods.map((m) => m.line), ...p.voice.examples.good, ...p.playbook.map((e) => e.lines));
      for (const l of lines) expect(l, l).not.toMatch(ADDRESS);
    });
  }
});

describe("clocks (IST)", () => {
  const presence = (id: string, d: ReturnType<typeof at>) => heart.timeBlock(d, PERSONAS[id]).presence;
  it("M01 on a Wednesday night and a Saturday", () => {
    expect(presence("M01", at(2026, 5, 13, 2, 0))).toBe("On the back steps");
    expect(presence("M01", at(2026, 5, 13, 3, 0))).toBe("Asleep");
    expect(presence("M01", at(2026, 5, 16, 14, 0))).toBe("Open");
    expect(presence("M01", at(2026, 5, 16, 19, 0))).toBe("In service");
  });
  it("the others on their given slots", () => {
    expect(presence("M03", at(2026, 5, 12, 21, 0))).toBe("In a contest");
    expect(presence("M04", at(2026, 5, 12, 4, 0))).toBe("On the balcony");
    expect(presence("M04", at(2026, 5, 12, 5, 0))).toBe("Asleep");
    expect(presence("M07", at(2026, 5, 12, 23, 0))).toBe("In the office");
    expect(presence("M08", at(2026, 5, 12, 22, 0))).toBe("Lights out");
    expect(presence("M09", at(2026, 5, 12, 23, 0))).toBe("Lights out");
    expect(presence("M10", at(2026, 5, 13, 2, 0))).toBe("After closing");
    expect(presence("M10", at(2026, 5, 13, 4, 0))).toBe("Asleep");
  });
});

describe("isLive", () => {
  const c = (templateId: string, primary: CoreId | null) => ({ templateId, core: { primary } });
  it("each man is live for a qa owner with a matching primary, and not for a normal owner", () => {
    for (const id of MEN) {
      expect((LIVE_TEMPLATES as Record<string, string>)[id]).toBe("qa");
      expect(personaFor(id).id).toBe(id);
      expect(isLive(c(id, brainOf(id)), true), id).toBe(true);
      expect(isLive(c(id, brainOf(id)), false), id).toBe(false);
    }
  });
  it("a mismatched primary is never live", () => {
    expect(isLive(c("M01", "MONEY"), true)).toBe(false);
    expect(isLive(c("M06", "ROMANTIC"), true)).toBe(false);
    expect(isLive(c("M08", "PSYCH"), true)).toBe(false);
  });
});
