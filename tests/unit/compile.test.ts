import { describe, it, expect } from "vitest";
import { compile, type CompileCtx } from "@/lib/llm/compile";
import * as heart from "@/lib/heart";
import { F01 } from "@/personas/persona";
import { variantsFor } from "@/personas/cores/romantic";

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
    expect(s.system).toContain("L1: exactly one bubble.");
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
    expect(compile(ctx(1)).system).toContain("none (always null)");
    expect(compile(ctx(4)).system).toContain("soft, loud, stop, ink");
    expect(compile(ctx(4)).system).not.toContain("soft, loud, stop, ink, pin");
    expect(compile(ctx(5)).system).toContain("pin, screen");
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
