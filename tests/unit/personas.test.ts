import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { compile, type CompileCtx } from "@/lib/llm/compile";
import { lintReply } from "@/lib/llm/lint";
import * as heart from "@/lib/heart";
import { isLive } from "@/lib/live";
import { addCardState } from "@/lib/addCard";
import { F01 } from "@/personas/persona";
import { F02, LIVE_TEMPLATES, PERSONAS, personaFor } from "@/personas/registry";
import { examplePairs } from "@/personas/cores/romantic";
import { iraSnapshot } from "./iraSnapshotFixture";

const snap = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "__snapshots__", name), "utf8")) as ReturnType<typeof iraSnapshot>;

// Wall clock in IST, as UTC ms.
const ist = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 5.5 * 3600000;
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => heart.istNow(ist(y, mo, d, h, mi));

describe("Ira prompt regression (B4 step 0)", () => {
  const before = snap("ira-prompt-before.json");
  const after = snap("ira-prompt-after.json");
  const now = iraSnapshot();

  it("matches the updated snapshot byte for byte", () => {
    expect(JSON.parse(JSON.stringify(now))).toEqual(after);
  });

  it("differs from the pre-registry prompt only by the split spelling rule and the Household label", () => {
    // The old spelling rule shared a line with the bubble-length rule, and Flatmates is now Household.
    const norm = (s: string) =>
      s
        .replace('- Spell her college "SPA Delhi". Each bubble is one line, at most 200 characters.', '- Spell her college "SPA Delhi".\n- Each bubble is one line, at most 200 characters.')
        .replace(/^Flatmates: /m, "Household: ");
    for (const level of Object.keys(before)) {
      const a = now[level];
      const b = before[level];
      expect(new Set(a.system.split("\n")), level).toEqual(new Set(norm(b.system).split("\n")));
      expect(a.system, level).toBe(norm(b.system));
      expect(a.volatile, level).toBe(b.volatile);
      expect(a.messages, level).toEqual(b.messages);
    }
  });

  it("golden message pairs are byte-identical", () => {
    for (const level of Object.keys(before)) {
      const n = examplePairs(F01, Number(level.slice(1))).length;
      expect(now[level].messages.slice(0, n)).toEqual(before[level].messages.slice(0, n));
    }
  });
});

describe("registry", () => {
  it("returns F01 and F02 and throws on unknown ids", () => {
    expect(personaFor("F01")).toBe(F01);
    expect(personaFor("F02")).toBe(F02);
    expect(PERSONAS.F02.name).toBe("Noor Qureshi");
    expect(() => personaFor("M01")).toThrow();
    expect(() => personaFor("")).toThrow();
  });
  it("lists F01 for everyone and the other nine for qa", () => {
    expect(LIVE_TEMPLATES).toEqual({ F01: "all", F02: "qa", F03: "qa", F04: "qa", F05: "qa", F07: "qa", F08: "qa", F09: "qa", F11: "qa", F13: "qa" });
    expect(Object.keys(PERSONAS)).toHaveLength(10);
  });
});

describe("isLive", () => {
  const c = (templateId: string, primary: "ROMANTIC" | "PSYCH" | null = "ROMANTIC") => ({ templateId, core: { primary } });
  it("F01 is live for any owner", () => {
    expect(isLive(c("F01"), false)).toBe(true);
    expect(isLive(c("F01"), true)).toBe(true);
  });
  it("F02 is live for a qa or admin owner only", () => {
    expect(isLive(c("F02"), true)).toBe(true);
    expect(isLive(c("F02"), false)).toBe(false);
  });
  it("F02 under a PSYCH primary is not live", () => {
    expect(isLive(c("F02", "PSYCH"), true)).toBe(false);
  });
  it("M01 is not live", () => {
    expect(isLive(c("M01"), true)).toBe(false);
    expect(isLive(c("M01"), false)).toBe(false);
  });
});

describe("heart for Noor", () => {
  it("10:00 on a Tuesday is At the wheel, card Wheel", () => {
    const b = heart.timeBlock(at(2026, 5, 12, 10, 0), F02);
    expect(b.presence).toBe("At the wheel");
    expect(b.card).toBe("Wheel");
  });
  it("0:15 is still the bukhari block and 0:45 is asleep", () => {
    expect(heart.timeBlock(at(2026, 5, 12, 0, 15), F02).presence).toBe("By the bukhari");
    expect(heart.timeBlock(at(2026, 5, 12, 0, 45), F02).presence).toBe("Asleep");
  });
  it("evening starts at 18:30 on weekdays and weekends", () => {
    expect(heart.timeBlock(at(2026, 5, 12, 18, 29), F02).presence).toBe("Packing");
    expect(heart.timeBlock(at(2026, 5, 12, 18, 30), F02).presence).toBe("Home");
    expect(heart.timeBlock(at(2026, 5, 17, 18, 30), F02).presence).toBe("Home"); // Sunday
    expect(heart.timeBlock(at(2026, 5, 17, 18, 29), F02).presence).toBe("Open");
  });
  it("Chillai Kalan can be picked on 10 January and never on 10 June", () => {
    const seen = (y: number, mo: number, d: number) => {
      const out = new Set<string>();
      for (let i = 0; i < 300; i++) out.add(heart.moodFor(`c_${i}`, at(y, mo, d), F02).mood);
      return out;
    };
    expect(seen(2027, 1, 10).has("Chillai Kalan")).toBe(true);
    expect(seen(2026, 6, 10).has("Chillai Kalan")).toBe(false);
    expect(heart.moodWeight("Chillai Kalan", at(2026, 12, 21), F02)).toBe(3);
    expect(heart.moodWeight("Chillai Kalan", at(2026, 12, 20), F02)).toBe(0);
    expect(heart.moodWeight("Chillai Kalan", at(2027, 1, 31), F02)).toBe(3);
    expect(heart.moodWeight("Chillai Kalan", at(2027, 2, 1), F02)).toBe(0);
  });
  it("Rasool sahab weighs 0 off-Friday, and its tone is ordinary below L3", () => {
    expect(heart.moodWeight("Rasool sahab", at(2026, 5, 15), F02)).toBe(2); // Friday
    for (const d of [11, 12, 13, 14, 16, 17]) expect(heart.moodWeight("Rasool sahab", at(2026, 5, d), F02)).toBe(0);
    expect(F02.engine.gatedMoods["Rasool sahab"]).toBe(3);
    const mood = F02.moods.find((m) => m.mood === "Rasool sahab")!;
    const h = heart.now({ id: "c_n", createdAt: ist(2026, 4, 1) }, ist(2026, 5, 15, 10), F02);
    const base: Omit<CompileCtx, "level" | "heart"> = { mode: "reply", userName: "", milestone: null, facts: [], weekSummaries: [], daySummaries: [], history: [{ id: 1, who: "me", text: "hi" }], coolOff: false, safetyMode: false, lowEffort: false, persona: F02 };
    const forced = { ...h, mood: { mood: mood.mood, texting: mood.texting, line: mood.line } };
    expect(compile({ ...base, level: 2, heart: forced }).volatile).toContain("Mood tone: ordinary.");
    expect(compile({ ...base, level: 3, heart: forced }).volatile).toContain(`Mood tone: ${mood.texting}.`);
  });
  it("special cards come from the persona", () => {
    const block = heart.timeBlock(at(2026, 5, 12, 10), F02);
    const mood = (m: string) => ({ mood: m, texting: "", line: "" });
    expect(heart.contextCardKey(block, mood("Chillai Kalan"), false, F02)).toBe("Chillai day");
    expect(heart.contextCardKey(block, mood("Power cut"), false, F02)).toBe("Power cut");
    expect(heart.contextCardKey(block, mood("Barfi chaos"), false, F02)).toBe("Wheel");
    expect(heart.contextCardKey(block, mood("Barfi chaos"), true, F02)).toBe("Level-up");
  });
  it("her birthday is 17 February", () => {
    const base = { createdDayKey: "2025-01-01", relationshipDay: 10, rainMentioned: false, leveledUp: null, persona: F02 };
    expect(heart.milestoneFor({ ist: at(2026, 2, 17), ...base })?.note).toContain("17 February");
    expect(heart.milestoneFor({ ist: at(2026, 3, 27), ...base })).toBeNull();
  });
  it("Ira's moods weigh exactly as the old switch did, over 30 dates", () => {
    const old = (mood: string, d: heart.IstParts): number => {
      const { weekday, month, dom, year } = d;
      const lastThree = dom > new Date(Date.UTC(year, month, 0)).getUTCDate() - 3;
      switch (mood) {
        case "Site day":
          return weekday === 2 || weekday === 4 ? 4 : 0;
        case "Principal pressure":
          return weekday === 1 ? 4 : 1;
        case "Budget close":
          return weekday === 5 || lastThree ? 4 : 1;
        case "Fog slow":
          return month === 12 || month === 1 ? 3 : 0;
        case "Smog shutdown":
          return month === 11 && dom <= 20 ? 3 : 0;
        case "Missing Nani's house":
          return weekday === 0 ? 2 : 0;
        default:
          return 1;
      }
    };
    const dates: heart.IstParts[] = [];
    for (let i = 0; i < 30; i++) dates.push(heart.istNow(Date.UTC(2026, 0, 1) + i * 12 * 86400000 + 5 * 3600000));
    for (const d of dates) for (const m of F01.moods) expect(heart.moodWeight(m.mood, d, F01), `${m.mood} ${d.dayKey}`).toBe(old(m.mood, d));
  });
  it("Ira's Tue/Thu Site card is data", () => {
    expect(heart.timeBlock(at(2026, 5, 12, 11), F01).card).toBe("Site");
    expect(heart.timeBlock(at(2026, 5, 13, 11), F01).card).toBe("Studio");
  });
});

describe("Noor compile", () => {
  const now = ist(2026, 5, 12, 10);
  const h = heart.now({ id: "c_noor", createdAt: now - 40 * 86400000 }, now, F02);
  const ctx = (level: number): CompileCtx => ({ level, mode: "reply", userName: "Riya", heart: h, milestone: null, facts: [], weekSummaries: [], daySummaries: [], history: [{ id: 5, who: "me", text: "hello" }], coolOff: false, safetyMode: false, lowEffort: false, persona: F02 });

  for (const level of [1, 3, 6]) {
    it(`L${level}: names Noor's world and none of Ira's`, () => {
      const c = compile(ctx(level));
      // Noor's own sheet sells to Delhi stores and attends a Delhi craft fair; those are hers, not Ira's city.
      const all = (c.system + "\n" + c.volatile).replaceAll("Delhi and Bangalore", "").replaceAll("Delhi craft fair", "");
      for (const w of ["Noor", "Srinagar", "17 February", "Household:"]) expect(all).toContain(w);
      for (const w of ["Delhi", "SPA", "Tanvi", "Kabir", "Rhea", "Nani", "geyser", "thekedar"]) expect(all, w).not.toMatch(new RegExp(`\\b${w}\\b`));
      expect(c.system).toContain("a 23-year-old in Srinagar");
      const n = examplePairs(F02, level).length;
      const golden = F02.golden[level >= 5 ? "5" : level >= 3 ? "3" : "1"];
      expect(c.messages.slice(0, n).filter((m) => m.role === "user").map((m) => m.content)).toEqual(golden.map((g) => g.user));
    });
  }
});

describe("lint on F02's golden set", () => {
  // The approved sheet's L5 "good enough" example asks two questions (rule f). Kept verbatim; flagged in the B4 report.
  const KNOWN: Record<string, string[]> = { "i'm scared i'll never be good enough": ["f"] };
  it("every pair passes lintReply (one known rule f exception)", () => {
    for (const tier of ["1", "3", "5"] as const) {
      for (const g of F02.golden[tier]) {
        const out = { bubbles: g.bubbles.map((text) => ({ text, effect: null })) };
        expect(lintReply(out, g.user), `${tier}: ${g.user}`).toEqual(KNOWN[g.user] ?? []);
      }
    }
  });
});

describe("addCard", () => {
  it("returns cap at 3 and at 4", () => {
    expect(addCardState(3, false)).toBe("cap");
    expect(addCardState(4, false)).toBe("cap");
    expect(addCardState(2, false)).toBe("add");
    expect(addCardState(2, true)).toBe("exhausted");
  });
});
