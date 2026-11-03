import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { compile, outputContract, type CompileCtx } from "@/lib/llm/compile";
import * as heart from "@/lib/heart";
import { isLive } from "@/lib/live";
import { CORE_MAP } from "@/lib/coreMap";
import { PERSONA_TZ } from "@/lib/presenceTz";
import { isDaytimeIn } from "@/lib/clock";
import { questionCount } from "@/lib/llm/lint";
import { coreDef } from "@/personas/cores";
import { F01, type Persona } from "@/personas/persona";
import { LIVE_TEMPLATES, PERSONAS, brainOf, personaFor } from "@/personas/registry";
import type { CoreId } from "@/state/schema";
import { promptSnapshot } from "./iraSnapshotFixture";

const TWELVE = ["F06", "F10", "F12", "F14", "F15", "F16", "M11", "M12", "M13", "M14", "M15", "M16"];
const ZONED: Record<string, string> = { F14: "Asia/Tokyo", F15: "Asia/Manila", F16: "America/Sao_Paulo", M14: "Asia/Seoul", M15: "Africa/Lagos", M16: "Europe/Rome" };
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const ist = (y: number, mo: number, d: number, h = 0, mi = 0) => utc(y, mo, d, h, mi) - 5.5 * 3600000;
const mins = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const FEM = /\b(she|her|hers|herself)\b/i;
const ADDRESS = /\b(bhai|bro|bhaiya|dada|daju|bawa|macha|bruh|dude|beta|sir|didi|sis)\b/i;
const file = (id: string) => readFileSync(path.join(__dirname, "../../src/personas", `${id}.persona.json`), "utf8");

describe("twelve faces: schema and registry", () => {
  for (const id of TWELVE) {
    const p = PERSONAS[id];
    describe(id, () => {
      it("is registered, live for everyone, and has every Persona key", () => {
        expect(p.id).toBe(id);
        expect(Object.keys(p).sort()).toEqual(Object.keys(F01).sort());
        expect((LIVE_TEMPLATES as Record<string, string>)[id]).toBe("all");
        expect(personaFor(id)).toBe(p);
      });
      it("keeps tables aligned and names real cards, energies and moods", () => {
        expect(p.weekday.length).toBe(p.engine.cards.length);
        expect(p.weekday.length).toBe(p.engine.blockStarts.length);
        expect(p.weekday.length).toBeGreaterThanOrEqual(7);
        for (const c of [...p.engine.cards, ...Object.values(p.engine.specialCards), "Morning", "Lunch", "Level-up"]) expect(Object.keys(p.contextCards), c).toContain(c);
        for (const k of [...p.weekday.map((r) => r.presence), "Open", "Asleep"]) expect(Object.keys(p.engine.energy), k).toContain(k);
        const moods = p.moods.map((m) => m.mood);
        for (const k of [...p.engine.moodRules.map((r) => r.mood), ...Object.keys(p.engine.gatedMoods), ...Object.keys(p.engine.specialCards)]) expect(moods, k).toContain(k);
        const starts = p.engine.blockStarts.map(mins);
        for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1]);
        expect(mins(p.engine.nightEnd) + 1440).toBeGreaterThan(starts[starts.length - 1]);
      });
      it("has 6 seasons, 12 arc beats, 7 week days, 6 levels, 10 moods and golden tiers 1, 3, 5", () => {
        expect([p.seasons.length, p.arc.length, p.week.length, p.levels.length, p.moods.length]).toEqual([6, 12, 7, 6, 10]);
        expect(Object.keys(p.golden).sort()).toEqual(["1", "3", "5"]);
        for (const g of p.golden["1"]) expect(g.bubbles, g.user).toHaveLength(1);
        for (const t of ["1", "3", "5"] as const) for (const g of p.golden[t]) { for (const b of g.bubbles) expect(b.length).toBeLessThanOrEqual(200); expect(questionCount(g.bubbles), g.user).toBeLessThanOrEqual(1); }
        for (const l of p.levels) expect(questionCount([l.line]), `L${l.level}`).toBeLessThanOrEqual(1);
      });
      it("has no em or en dashes, no address terms, and introduces every person", () => {
        expect(file(id)).not.toMatch(/[\u2014\u2013]/);
        const lines: string[] = [];
        for (const t of ["1", "3", "5"] as const) for (const g of p.golden[t]) lines.push(...g.bubbles);
        lines.push(...p.levels.map((l) => l.line), p.l6Line, ...p.moods.map((m) => m.line), ...p.voice.examples.good, ...p.playbook.map((e) => e.lines));
        for (const l of lines) expect(l, l).not.toMatch(ADDRESS);
        for (const name of p.engine.people) {
          const rule = p.engine.hardRules.find((r) => r.toLowerCase().includes(name.toLowerCase()));
          expect(rule, name).toBeTruthy();
          expect(rule, name).toMatch(/\("[^"]*"\)|\(\\?"[^)]*\)/);
        }
      });
      it("matches the V7 core map", () => {
        expect(brainOf(id)).toBe(CORE_MAP[id][0]);
        const second = CORE_MAP[id][1];
        expect(p.secondaryCore === "none" || (second !== null && p.secondaryCore.startsWith(second))).toBe(true);
      });
      it("declares engine.tz exactly when the face lives outside India", () => {
        expect(p.engine.tz).toBe(ZONED[id]);
        expect(PERSONA_TZ[id]).toBe(ZONED[id]);
      });
    });
  }
  it("PERSONA_TZ lists only the six zoned faces, and no other persona declares a zone", () => {
    expect(Object.keys(PERSONA_TZ).sort()).toEqual(Object.keys(ZONED).sort());
    for (const [id, p] of Object.entries(PERSONAS)) if (!(id in ZONED)) expect(p.engine.tz, id).toBeUndefined();
  });
});

describe("twelve faces: compile at L1 to L6", () => {
  const ctx = (p: Persona, level: number, t: number): CompileCtx => ({ level, mode: "reply", userName: "Riya", heart: heart.now({ id: "c_x", createdAt: t - 40 * 86400000 }, t, p), milestone: null, facts: [], weekSummaries: [], daySummaries: [], history: [{ id: 5, who: "me", text: "hello" }], coolOff: false, safetyMode: false, lowEffort: false, persona: p });
  for (const id of TWELVE) {
    const p = PERSONAS[id]; const brain = brainOf(id); const def = coreDef(brain, p);
    for (const level of [1, 2, 3, 4, 5, 6]) {
      it(`${id} L${level}`, () => {
        const a = ist(2026, 5, 12, 10), b = ist(2026, 5, 14, 22);
        const c = compile(ctx(p, level, a));
        expect(c.system).toContain(`CORE (${def.name})`);
        for (const r of def.rules) expect(c.system).toContain(r);
        for (const l of p.levels) if (l.level !== level && l.line !== p.levels[level - 1].line) expect(c.system, `line of L${l.level}`).not.toContain(l.line);
        if (level >= 5) expect(c.system).toContain(p.l6Line); else expect(c.system).not.toContain(p.l6Line);
        expect(def.romanticEmojiFrom).toBe(brain === "ROMANTIC" ? 3 : 5);
        expect(outputContract(level, p)).toContain(level >= def.romanticEmojiFrom ? "Romantic emoji (\u2764\ufe0f \ud83d\ude18 \ud83d\udc8b \ud83e\udd70 \ud83d\ude0d) are fine" : "No romantic emoji yet");
        expect(compile(ctx(p, level, b)).stablePrefix).toBe(c.stablePrefix);
        if (id.startsWith("M")) for (const text of [c.system, c.volatile]) for (const line of text.split("\n")) { if (!line.startsWith("Family:")) expect(line, `${id} L${level}`).not.toMatch(FEM); }
      });
    }
  }
  it("guardrails reach the prompt", () => {
    const sys = (id: string) => compile(ctx(PERSONAS[id], 3, ist(2026, 5, 12, 10))).system;
    expect(sys("F15")).toContain("breath-hold");
    expect(sys("F06")).toContain("never say whether any water is safe");
    expect(sys("M12")).toContain("never say whether any beach, wave or water is safe");
    expect(sys("F16")).toContain("never say buy, sell or hold");
    expect(sys("M15")).toContain("not a lawyer");
    expect(sys("M11")).toContain("trained in music therapy");
    expect(sys("M13")).toContain("no longer practises");
    expect(sys("F14")).toContain("text only");
  });
  it("men use he, him and his in localized core text", () => {
    expect(compile(ctx(PERSONAS.M11, 3, ist(2026, 5, 12, 10))).system).toContain("Initiative: he leads as often as he follows.");
  });
});

describe("zoned clock", () => {
  const p = (id: string) => PERSONAS[id];
  it("reads each face's own wall clock, including Milan's summer and winter time", () => {
    const t = utc(2026, 5, 12, 4, 30); // 10:00 IST
    expect([heart.localNow(t, p("F14")).hour, heart.localNow(t, p("F14")).minute]).toEqual([13, 30]);
    expect(heart.localNow(t, p("M14")).hour).toBe(13);
    expect(heart.localNow(t, p("F15")).hour).toBe(12);
    expect(heart.localNow(t, p("M15")).hour).toBe(5);
    expect(heart.localNow(t, p("F16")).hour).toBe(1);
    expect(heart.localNow(t, p("M16")).hour).toBe(6);
    expect(heart.localNow(utc(2026, 1, 12, 4, 30), p("M16")).hour).toBe(5);
  });
  it("uses the local weekday when the date differs from IST", () => {
    const t = utc(2026, 5, 11, 20, 0); // Tuesday 01:30 IST
    expect(heart.istNow(t).weekday).toBe(2);
    expect(heart.localNow(t, p("F16")).weekday).toBe(1);
  });
  it("leaves every Indian face on IST, byte for byte", () => {
    const t = utc(2026, 5, 12, 4, 30);
    for (const id of Object.keys(PERSONAS)) if (!(id in ZONED)) expect(heart.localNow(t, p(id)), id).toEqual(heart.istNow(t));
  });
  it("presence follows the face's own clock", () => {
    const yuki = p("F14");
    expect(heart.now({ id: "c", createdAt: 0 }, utc(2026, 5, 12, 16, 0), yuki).block.presence).toBe("Asleep"); // 01:00 JST
    expect(heart.now({ id: "c", createdAt: 0 }, utc(2026, 5, 12, 14, 30), yuki).block.presence).toBe("Lights out"); // 23:30 JST
    expect(heart.now({ id: "c", createdAt: 0 }, utc(2026, 5, 12, 16, 0), p("F16")).block.presence).toBe("Open");
  });
  it("the clock line tells the model the face's own time", () => {
    const t = utc(2026, 5, 12, 4, 30);
    expect(heart.clockLine(heart.localNow(t, p("F14")))).toContain("1:30 pm");
  });
  it("the header's day or night variant follows the face's zone", () => {
    const t = utc(2026, 5, 12, 4, 30); // 10:00 IST = 13:30 Osaka = 01:00 Sao Paulo
    expect(isDaytimeIn(t, PERSONA_TZ.F14)).toBe(true);
    expect(isDaytimeIn(t, PERSONA_TZ.F16)).toBe(false);
    expect(isDaytimeIn(t)).toBe(true);
  });
});

describe("milestones for faces outside India", () => {
  const base = (persona: Persona, dayKey: string, rain = false) => heart.milestoneFor({ ist: { ...heart.istNow(Date.UTC(2026, 10, 8, 6)), dayKey, month: Number(dayKey.slice(5, 7)), dom: Number(dayKey.slice(8, 10)) }, createdDayKey: "2026-01-01", relationshipDay: 10, rainMentioned: rain, leveledUp: null, persona });
  it("Diwali fires for an Indian face and is skipped for a zoned one", () => {
    expect(base(PERSONAS.M04, "2026-11-08")?.kind).toBe("diwali");
    expect(base(PERSONAS.F14, "2026-11-08")).toBeNull();
  });
  it("the first-of-July rain moment is skipped for a zoned face", () => {
    expect(base(PERSONAS.M04, "2026-07-01", true)?.kind).toBe("rain");
    expect(base(PERSONAS.F16, "2026-07-01", true)).toBeNull();
  });
});

describe("isLive for the twelve", () => {
  const c = (templateId: string, primary: CoreId | null) => ({ templateId, core: { primary } });
  it("is live for every owner with a matching primary, never with a mismatch", () => {
    for (const id of TWELVE) {
      expect(isLive(c(id, brainOf(id)), false), id).toBe(true);
      expect(isLive(c(id, brainOf(id)), true), id).toBe(true);
    }
    expect(isLive(c("F06", "TRAINER"), true)).toBe(false);
    expect(isLive(c("M11", "ROMANTIC"), true)).toBe(false);
    expect(isLive(c("F12", "ROMANTIC"), false)).toBe(false);
  });
});

describe("regression: the existing 20 faces compile byte for byte", () => {
  const before = JSON.parse(readFileSync(path.join(__dirname, "__snapshots__/existing-prompts-before.json"), "utf8")) as Record<string, { system: string; volatile: string }>;
  const EXISTING = Object.keys(PERSONAS).filter((id) => !TWELVE.includes(id));
  it("covers exactly the 20 existing faces at L1, L3, L5, L6", () => {
    expect(EXISTING).toHaveLength(20);
    expect(Object.keys(before).sort()).toEqual(EXISTING.flatMap((id) => ["L1", "L3", "L5", "L6"].map((l) => `${id}.${l}`)).sort());
  });
  for (const id of EXISTING) {
    it(`${id} is unchanged`, () => {
      const snap = promptSnapshot(PERSONAS[id]);
      for (const l of ["L1", "L3", "L5", "L6"]) {
        expect(snap[l].system, `${id} ${l} system`).toBe(before[`${id}.${l}`].system);
        expect(snap[l].volatile, `${id} ${l} volatile`).toBe(before[`${id}.${l}`].volatile);
      }
    });
  }
});
