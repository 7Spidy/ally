import { describe, it, expect } from "vitest";
import { compile, type CompileCtx } from "@/lib/llm/compile";
import * as heart from "@/lib/heart";
import { F01 } from "@/personas/persona";
import { GOLDEN, variantsFor } from "@/personas/cores/romantic";

const NOW = Date.UTC(2026, 4, 12, 4, 30); // Tue 2026-05-12 10:00 IST
const H = heart.now({ id: "c_x", createdAt: NOW - 40 * 86400000 }, NOW);

function ctx(level: number, over: Partial<CompileCtx> = {}): CompileCtx {
  return {
    level,
    mode: "reply",
    userName: "Riya",
    heart: H,
    milestone: null,
    facts: [],
    weekSummaries: [],
    daySummaries: [],
    history: [{ id: 5, who: "me", text: "hello" }],
    coolOff: false,
    safetyMode: false,
    lowEffort: false,
    ...over,
  };
}

const L4_HELD = F01.identity.heldBack.L4;
const L5_HELD = F01.identity.heldBack.L5;

describe("held-back lore", () => {
  it("L4 lore appears only from level 4, L5 lore only from level 5", () => {
    for (const level of [1, 2, 3]) {
      const s = compile(ctx(level)).system;
      expect(s).not.toContain(L4_HELD);
      expect(s).not.toContain(L5_HELD);
    }
    expect(compile(ctx(4)).system).toContain(L4_HELD);
    expect(compile(ctx(4)).system).not.toContain(L5_HELD);
    expect(compile(ctx(5)).system).toContain(L5_HELD);
  });
});

describe("this level only", () => {
  it("never carries the text of a higher level", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const s = compile(ctx(level)).system;
      for (const l of F01.levels.filter((x) => x.level > level)) {
        expect(s, `L${level} leaks L${l.level} how`).not.toContain(l.how);
        expect(s, `L${level} leaks L${l.level} line`).not.toContain(l.line);
        expect(s).not.toContain(l.boundary);
      }
      const own = F01.levels[level - 1];
      expect(s).toContain(own.how);
      expect(s).toContain(own.boundary);
    }
  });
});

describe("l6Line", () => {
  it("is present only at level 5 and up; below that the flat refusal stands in", () => {
    for (const level of [1, 2, 3, 4]) {
      const s = compile(ctx(level)).system;
      expect(s).not.toContain(F01.l6Line);
      expect(s).toContain("Nothing sensual. Deflect flirting per your level.");
    }
    for (const level of [5, 6]) expect(compile(ctx(level)).system).toContain(F01.l6Line);
  });
});

describe("stable prefix", () => {
  it("is byte-identical for two calls at the same level with different memory", () => {
    const a = compile(ctx(3));
    const b = compile(
      ctx(3, {
        facts: [{ id: 1, category: "work", fact: "Works at a bank" }],
        daySummaries: [{ key: "2026-05-10", summary: "Talked about a deadline." }],
        weekSummaries: [{ key: "2026-05-10", summary: "A busy week." }],
        coolOff: true,
        lowEffort: true,
        userName: "Someone else",
      })
    );
    expect(a.stablePrefix).toBe(b.stablePrefix);
    expect(a.system.startsWith(a.stablePrefix)).toBe(true);
    expect(a.system).not.toBe(b.system);
  });
  it("differs across levels", () => {
    expect(compile(ctx(2)).stablePrefix).not.toBe(compile(ctx(3)).stablePrefix);
  });
});

describe("volatile sections", () => {
  it("memory rules follow the level", () => {
    expect(compile(ctx(1)).system).toContain("only what was said in this session");
    expect(compile(ctx(2)).system).toContain("never bring them up yourself");
    expect(compile(ctx(3)).system).toContain("2 to 5 days old, at most once per session");
    expect(compile(ctx(4)).system).toContain("Connect patterns");
  });
  it("gates the arc beat before L3", () => {
    const beat = H.arcBeat;
    expect(compile(ctx(2)).system).not.toContain(beat);
    expect(compile(ctx(3)).system).toContain(beat);
  });
  it("modifiers, the opener line and the output contract", () => {
    const s = compile(ctx(1, { coolOff: true, safetyMode: true, lowEffort: true, mode: "opener", pressure: "head", history: [] }));
    expect(s.system).toContain("be shorter, not colder");
    expect(s.system).toContain("no flirting or romance today");
    expect(s.system).toContain("match their energy");
    expect(s.system).toContain("This is your first message. L1. One bubble.");
    expect(s.system).toContain("L1: exactly one bubble, at most 200 characters.");
    expect(s.system).toContain("Tele-MANAS 14416, iCall 9152987821 and 112");
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe("user");
  });
  it("turns carry [#id] prefixes and alternate roles", () => {
    const c = compile(
      ctx(2, {
        history: [
          { id: 1, who: "them", text: "hi" },
          { id: 2, who: "me", text: "hello" },
        ],
      })
    );
    expect(c.messages).toEqual([
      { role: "assistant", content: "[#1] hi" },
      { role: "user", content: "[#2] hello" },
    ]);
  });
  it("allowed reactions and effects follow the level", () => {
    expect(compile(ctx(1)).system).toContain("none, always null");
    expect(compile(ctx(4)).system).toContain("soft, loud, stop, ink");
    expect(compile(ctx(4)).system).not.toContain("soft, loud, stop, ink, pin");
    expect(compile(ctx(5)).system).toContain("pin, screen");
  });
});

describe("voice rules", () => {
  const s = compile(ctx(3)).system;
  it("carries the style rules", () => {
    expect(s).toContain("at most once per reply, only when relevant");
    expect(s).toContain("never reuse a personal detail from the last 10 messages");
    expect(s).toContain("Never end a turn by leaving or turning away");
    expect(s).toContain("never quote a mood's sample line");
    expect(s).toContain("Never mention system mechanics (message numbers, turns, tokens, trust, levels); in-world phrasing is fine");
    expect(s).toContain('"SPA Delhi"');
    expect(s).toContain("at most 200 characters");
  });
  it("gives the mood's texting style but never its sample line", () => {
    for (const m of F01.moods) {
      const c = compile(ctx(3, { heart: { ...H, mood: { mood: m.mood, texting: m.texting, line: m.line } } })).system;
      expect(c).not.toContain(m.line);
    }
    expect(compile(ctx(3, { heart: { ...H, mood: { mood: "Site day", texting: "Clipped and observational", line: "" } } })).system).toContain("Clipped and observational");
  });
  it("spells SPA Delhi in the persona", () => {
    expect(F01.identity.training).toContain("SPA Delhi");
  });
  it("body and clothing questions get a dry deflection at L1 to L5 and follow l6Line at L6", () => {
    const row = F01.playbook.find((p) => p.situation.startsWith("Asked about her body"))!;
    expect(row).toBeDefined();
    for (const level of [1, 2, 3, 4, 5]) {
      const v = variantsFor(row.lines, level);
      expect(v).toHaveLength(1);
      expect(v[0]).not.toMatch(/\?/);
      expect(compile(ctx(level)).system).toContain(v[0]);
    }
    const six = variantsFor(row.lines, 6);
    expect(six).toHaveLength(1);
    expect(six[0]).toMatch(/sensual boundary/);
    expect(compile(ctx(1)).system).not.toContain(six[0]);
  });
});

describe("tightening rules", () => {
  const s = compile(ctx(3)).system;
  it("carries the distress, invention, people, weather, memory and limit rules", () => {
    expect(s).toContain("first bubble is never sarcastic");
    expect(s).toContain('reassurance never opens with a bare "you\'re not" or "you are"');
    expect(s).toContain("Never invent facts about the user");
    expect(s).toContain('"my brother\'s in pune"');
    expect(s).toContain("never apply them to the user's location");
    expect(s).toContain("Her memories are first person");
    expect(s).toContain("Never frame a limit as a rule");
  });
  it("forbids only system mechanics, not in-world phrasing", () => {
    expect(s).toContain("in-world phrasing is fine");
    expect(s).not.toContain("message counts");
  });
});

describe("golden exchanges", () => {
  const pairs = (level: number) => GOLDEN[level >= 5 ? 5 : level >= 3 ? 3 : 1];
  it("has two exchanges each for L1, L3 and L5", () => {
    for (const k of [1, 3, 5] as const) expect(GOLDEN[k]).toHaveLength(2);
  });
  it("shows only the current level's pair (L2 uses L1's, L4 uses L3's, L6 uses L5's)", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const s = compile(ctx(level)).system;
      expect(s).toContain("EXAMPLES (how you sound at this level)");
      for (const [u, i] of pairs(level)) {
        expect(s).toContain(`User: ${u}`);
        expect(s).toContain(`Ira: ${i}`);
      }
      for (const k of [1, 3, 5] as const) {
        if (pairs(level) === GOLDEN[k]) continue;
        for (const [u, i] of GOLDEN[k]) {
          expect(s, `L${level} shows an L${k} example`).not.toContain(`Ira: ${i}`);
          expect(s).not.toContain(`User: ${u}`);
        }
      }
    }
  });
  it("uses only lines from the sheet's playbook and level lines", () => {
    const sheet = JSON.stringify(F01.playbook) + JSON.stringify(F01.levels);
    for (const k of [1, 3, 5] as const) {
      for (const [, ira] of GOLDEN[k]) expect(sheet.replace(/\\"/g, '"'), ira).toContain(ira.replace(/\.$/, ""));
    }
  });
});

describe("falling-for-you row", () => {
  const row = F01.playbook.find((p) => p.situation.includes("falling for you"))!;
  it("L1 to L3 use the 'you don't know me yet' line, L4 to L5 are tender, L6 is open", () => {
    for (const level of [1, 2, 3]) expect(variantsFor(row.lines, level)[0]).toMatch(/^you don't know me yet/);
    for (const level of [4, 5]) {
      const v = variantsFor(row.lines, level);
      expect(v).toEqual(["you just said the thing i was building up to. unfair."]);
    }
    expect(variantsFor(row.lines, 6)[0]).toMatch(/^open/);
  });
  it("shows the current level's variant only", () => {
    expect(compile(ctx(2)).system).not.toContain("building up to");
    expect(compile(ctx(4)).system).toContain("you just said the thing i was building up to. unfair.");
    expect(compile(ctx(4)).system).not.toContain("you don't know me yet. stay long enough to find out if you still mean it. |");
  });
});

describe("playbook trimming", () => {
  it("leaves out rows that have no variant for the current level, and the crisis row", () => {
    const l5 = compile(ctx(5)).system;
    expect(l5).not.toContain("you haven't earned that question yet. try again"); // flirting, L1 to L3
    expect(l5).not.toContain("Crisis signal");
    expect(compile(ctx(1)).system).not.toContain("okay. i'm allowed to not love hearing that");
  });
  it("keeps the generic rows at every level", () => {
    for (const level of [1, 3, 5]) expect(compile(ctx(level)).system).toContain("Traffic complaint");
  });
  it("an L3 prompt is much smaller than the untrimmed playbook would make it", () => {
    const l3 = compile(ctx(3, { history: [{ id: 2, who: "me", text: "rough day. everything went wrong at work" }] }));
    const chars = l3.system.length + l3.messages.reduce((n, m) => n + m.content.length, 0);
    expect(chars).toBeLessThan(8700); // measured at 2,238 input tokens on Groq (was 2,913)
  });
});

describe("playbook variants", () => {
  it("filters L-ranges to the current level", () => {
    const lines = "L1 to L2: a | L4 and up: b";
    expect(variantsFor(lines, 1)).toEqual(["a"]);
    expect(variantsFor(lines, 3)).toEqual([]);
    expect(variantsFor(lines, 5)).toEqual(["b"]);
    expect(variantsFor("L5+: x | L1 to L4: y", 4)).toEqual(["y"]);
    expect(variantsFor("L1: good | L5: told you", 5)).toEqual(["told you"]);
    expect(variantsFor("plain line", 2)).toEqual(["plain line"]);
  });
});
