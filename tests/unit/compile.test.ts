import { describe, it, expect } from "vitest";
import { compile, JSON_REMINDER, SAMPLES_END, WINDOW_MAX, windowStart, type CompileCtx, type CompileTurn } from "@/lib/llm/compile";
import { hasHandle } from "@/lib/llm/lint";
import * as heart from "@/lib/heart";
import { F01 } from "@/personas/persona";
import { examplePairs as examplePairsFor, ownershipBlock as ownershipBlockFor, variantsFor } from "@/personas/cores/romantic";

const GOLDEN = F01.golden as Record<1 | 3 | 5, { user: string; bubbles: string[] }[]>;
const examplePairs = (level: number) => examplePairsFor(F01, level);
const ownershipBlock = () => ownershipBlockFor(F01);

const NOW = Date.UTC(2026, 4, 12, 4, 30); // Tue 2026-05-12 10:00 IST
const H = heart.now({ id: "c_x", createdAt: NOW - 40 * 86400000 }, NOW, F01);

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
    persona: F01,
    ...over,
  };
}

const EMOJI_LINE = "Emoji: your last two replies had none";
const DRY_HISTORY: CompileTurn[] = [
  { id: 1, who: "me", text: "hello" },
  { id: 2, who: "them", text: "hey you" },
  { id: 3, who: "me", text: "how are you" },
  { id: 4, who: "them", text: "good, you?" },
  { id: 5, who: "me", text: "tired" },
];

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
  it("system is byte-identical for two calls at the same level with different memory, heart state and modifiers", () => {
    const a = compile(ctx(3));
    const b = compile(
      ctx(3, {
        facts: [{ id: 1, category: "work", fact: "Works at a bank" }],
        daySummaries: [{ key: "2026-05-10", summary: "Talked about a deadline." }],
        weekSummaries: [{ key: "2026-05-10", summary: "A busy week." }],
        heart: { ...H, block: { ...H.block, presence: "Balcony", activity: "something else entirely" } },
        coolOff: true,
        lowEffort: true,
        userName: "Someone else",
      })
    );
    const c = compile(ctx(3, { history: DRY_HISTORY }));
    expect(a.system).toBe(b.system);
    expect(a.system).toBe(c.system);
    expect(c.volatile).toContain(EMOJI_LINE);
    expect(a.system.startsWith(a.stablePrefix)).toBe(true);
    expect(a.volatile).not.toBe(b.volatile);
  });
  it("differs across levels", () => {
    expect(compile(ctx(2)).stablePrefix).not.toBe(compile(ctx(3)).stablePrefix);
  });
  it("never holds a volatile section", () => {
    const s = compile(ctx(3)).system;
    for (const h of ["RIGHT NOW", "YOUR DAY", "WHAT YOU KNOW ABOUT THE USER", "YOUR OWN LIFE", "MODIFIERS"]) expect(s, h).not.toContain(`\n\n${h}`);
  });
});

describe("emoji floor", () => {
  it("adds the directive to volatile, never system, when the last two replies were emoji-free", () => {
    const c = compile(ctx(3, { history: DRY_HISTORY }));
    expect(c.volatile).toContain(EMOJI_LINE);
    expect(c.system).not.toContain(EMOJI_LINE);
  });
  it("is absent when a recent reply had an emoji", () => {
    const history = DRY_HISTORY.map((t) => (t.id === 4 ? { ...t, text: "good, you? 😊" } : t));
    expect(compile(ctx(3, { history })).volatile).not.toContain(EMOJI_LINE);
  });
  it("is absent in opener mode", () => {
    expect(compile(ctx(3, { mode: "opener", history: DRY_HISTORY })).volatile).not.toContain(EMOJI_LINE);
  });
});

describe("volatile sections", () => {
  it("memory rules follow the level", () => {
    expect(compile(ctx(1)).volatile).toContain("only what was said in this session");
    expect(compile(ctx(2)).volatile).toContain("never bring them up yourself");
    expect(compile(ctx(3)).volatile).toContain("2 to 5 days old, at most once per session");
    expect(compile(ctx(4)).volatile).toContain("Connect patterns");
  });
  it("gates the arc beat before L3", () => {
    const beat = H.arcBeat;
    expect(compile(ctx(2)).volatile).not.toContain(beat);
    expect(compile(ctx(3)).volatile).toContain(beat);
  });
  it("modifiers, the opener line and the output contract", () => {
    const s = compile(ctx(1, { coolOff: true, safetyMode: true, lowEffort: true, mode: "opener", pressure: "head", history: [] }));
    expect(s.volatile).toContain("be shorter, not colder");
    expect(s.volatile).toContain("no flirting or romance today");
    expect(s.volatile).toContain("stay short, but lead");
    expect(s.volatile).not.toContain("match their energy");
    expect(s.volatile).toContain("This is your first message. L1. One bubble.");
    expect(s.system).toContain("L1: exactly one bubble, at most 200 characters.");
    expect(s.system).toContain("Tele-MANAS 14416, iCall 9152987821 and 112");
    expect(s.messages).toHaveLength(examplePairs(1).length + 1);
    const last = s.messages[s.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content.startsWith(`${SAMPLES_END}\n\n(The chat has just opened.`)).toBe(true);
    expect(last.content).toContain("This is your first message.");
  });
  it("only user turns carry [#id]; the volatile context rides on the last user turn", () => {
    const c = compile(
      ctx(2, {
        history: [
          { id: 1, who: "them", text: "hi" },
          { id: 2, who: "me", text: "hello" },
        ],
      })
    );
    const n = examplePairs(2).length;
    expect(c.messages.slice(0, n)).toEqual(examplePairs(2));
    expect(c.messages.slice(n, n + 2)).toEqual([
      { role: "user", content: SAMPLES_END },
      { role: "assistant", content: "hi" },
    ]);
    expect(c.messages[n + 2]).toEqual({ role: "user", content: `[#2] hello\n\n(Context for this reply. Not from the user. Never quote it.)\n${c.volatile}\n\n${JSON_REMINDER}` });
    expect(c.messages).toHaveLength(n + 3);
  });
  it("a history that starts with a user turn carries the separator on that turn", () => {
    const c = compile(ctx(2));
    const n = examplePairs(2).length;
    expect(c.messages).toHaveLength(n + 1);
    expect(c.messages[n].content.startsWith(`${SAMPLES_END}\n\n[#5] hello`)).toBe(true);
  });
  it("allowed reactions and effects follow the level", () => {
    expect(compile(ctx(1)).system).toContain("none, always null");
    expect(compile(ctx(4)).system).toContain("soft, loud, stop, ink");
    expect(compile(ctx(4)).system).not.toContain("soft, loud, stop, ink, pin");
    expect(compile(ctx(5)).system).toContain("pin, screen");
  });
});

describe("history window", () => {
  it("windowStart moves only in steps of 10", () => {
    for (const [total, start] of [[0, 0], [30, 0], [31, 10], [40, 10], [41, 20], [50, 20], [51, 30]]) expect(windowStart(total), String(total)).toBe(start);
  });
  it("keeps 21 to 30 messages past 30, whatever the history offset", () => {
    for (let total = 31; total <= 60; total++) {
      const offset = total - Math.min(total, 40);
      // the last turn is always the user's, alternating back from there
      const all: CompileTurn[] = Array.from({ length: total }, (_, i) => ({ id: i + 1, who: ((total - 1 - i) % 2 === 0 ? "me" : "them") as "me" | "them", text: `m${i}` })).slice(offset);
      const c = compile(ctx(3, { history: all, historyOffset: offset }));
      const body = c.messages.slice(examplePairs(3).length);
      const kept = body.length - (body[0].content === SAMPLES_END ? 1 : 0);
      expect(kept, `total ${total}`).toBe(total - windowStart(total));
      expect(kept).toBeGreaterThanOrEqual(21);
      expect(kept).toBeLessThanOrEqual(WINDOW_MAX);
    }
  });
  it("the first kept message is the same for every count between two shifts, so the prefix is stable", () => {
    const turns = Array.from({ length: 40 }, (_, i): CompileTurn => ({ id: i + 1, who: i % 2 ? "them" : "me", text: `m${i}` }));
    const firstId = (total: number) => {
      const c = compile(ctx(3, { history: turns.slice(0, total) }));
      return c.messages[examplePairs(3).length].content.match(/\[#(\d+)\]/)?.[1];
    };
    expect(firstId(32)).toBe(firstId(33));
    expect(firstId(32)).toBe(firstId(40));
  });
  it("assistant history turns carry no id", () => {
    const c = compile(ctx(3, { history: [{ id: 7, who: "them", text: "hey you" }, { id: 8, who: "me", text: "hi" }] }));
    expect(c.messages.filter((m) => m.role === "assistant").some((m) => /\[#\d+\]/.test(m.content))).toBe(false);
  });
});

describe("voice rules", () => {
  const s = compile(ctx(3)).system;
  it("carries the style rules", () => {
    expect(s).toContain("one concrete detail per reply at most, offered as a handle");
    expect(s).toContain("never reuse a personal detail from the last 10 messages");
    expect(s).toContain("Never end a turn by leaving or turning away");
    expect(s).toContain("never quote a mood's sample line");
    expect(s).toContain("Never mention system mechanics (message numbers, turns, tokens, trust, levels); in-world phrasing is fine");
    expect(s).toContain('"SPA Delhi"');
    expect(s).toContain("at most 200 characters");
  });
  it("gives the mood's texting style but never its sample line", () => {
    for (const m of F01.moods) {
      const c = compile(ctx(3, { heart: { ...H, mood: { mood: m.mood, texting: m.texting, line: m.line } } }));
      expect(c.system).not.toContain(m.line);
      expect(c.volatile).not.toContain(m.line);
    }
    expect(compile(ctx(3, { heart: { ...H, mood: { mood: "Site day", texting: "Clipped and observational", line: "" } } })).volatile).toContain("Clipped and observational");
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

describe("conversation ownership", () => {
  it("the block is in every level's system prompt, after the playbook and before the examples note", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const s = compile(ctx(level)).system;
      expect(s, `L${level}`).toContain(ownershipBlock());
      expect(s.indexOf("\n\nCONVERSATION OWNERSHIP")).toBeGreaterThan(s.indexOf("SITUATIONAL PLAYBOOK"));
      expect(s.indexOf("\n\nCONVERSATION OWNERSHIP")).toBeLessThan(s.indexOf("EXAMPLES (style only)"));
      expect(s).toContain("Initiative: she leads as often as she follows.");
    }
  });
  it("asks for at most one question and never a time promise", () => {
    const b = ownershipBlock();
    expect(b).toContain("At most one question per reply");
    expect(b).toContain("no time promise");
    expect(b).toContain("never a promise of a time");
  });
});

describe("golden exchanges", () => {
  const key = (level: number) => (level >= 5 ? 5 : level >= 3 ? 3 : 1);
  const COUNTS = { 1: 4, 3: 3, 5: 3 } as const;
  it("has at least the planned pairs for L1, L3 and L5", () => {
    for (const k of [1, 3, 5] as const) expect(GOLDEN[k].length).toBeGreaterThanOrEqual(COUNTS[k]);
  });
  it("most pairs leave a handle (about two in three, never fewer)", () => {
    for (const k of [1, 3, 5] as const) {
      const withHandle = GOLDEN[k].filter((g) => hasHandle(g.bubbles)).length;
      expect(withHandle / GOLDEN[k].length, `L${k}`).toBeGreaterThanOrEqual(2 / 3);
    }
    // every L1 pair does: L1 is where she most needs to lead
    for (const g of GOLDEN[1]) expect(hasHandle(g.bubbles), g.user).toBe(true);
  });
  it("is warm and promises no time", () => {
    for (const k of [1, 3, 5] as const) {
      for (const g of GOLDEN[k]) {
        const text = g.bubbles.join(" ");
        expect(text).not.toMatch(/noted\. filed|not allowed/i);
        // "a later question" is a deflection, not a promise; every other later, tonight and tomorrow is out
        expect(text, g.user).not.toMatch(/\btonight\b|\btomorrow\b|(?<!a )\blater\b/i);
      }
    }
  });
  it("L1 pairs are one bubble of at most 200 characters", () => {
    for (const g of GOLDEN[1]) {
      expect(g.bubbles).toHaveLength(1);
      expect(g.bubbles[0].length).toBeLessThanOrEqual(200);
    }
    for (const k of [3, 5] as const) for (const g of GOLDEN[k]) for (const b of g.bubbles) expect(b.length).toBeLessThanOrEqual(200);
  });
  it("names her people only with a relationship word", () => {
    for (const k of [1, 3, 5] as const) for (const g of GOLDEN[k]) for (const name of F01.engine.people) expect(g.bubbles.join(" ")).not.toMatch(new RegExp(`\\b${name}\\b`, "i"));
  });
  it("ships as user and assistant messages: raw user text, assistant JSON in the contract's key order", () => {
    const KEYS = ["bubbles", "reaction", "quoteId", "screen", "riskLevel", "ageClaimUnder18", "disclosure", "mutualVulnerability", "abusive"];
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const pairs = examplePairs(level);
      const src = GOLDEN[key(level)];
      expect(pairs).toHaveLength(src.length * 2);
      src.forEach((g, i) => {
        expect(pairs[2 * i]).toEqual({ role: "user", content: g.user });
        expect(pairs[2 * i].content).not.toMatch(/\[#\d+\]/);
        const o = JSON.parse(pairs[2 * i + 1].content);
        expect(pairs[2 * i + 1].role).toBe("assistant");
        expect(Object.keys(o)).toEqual(KEYS);
        expect(o.bubbles).toEqual(g.bubbles.map((text) => ({ text, effect: null })));
      });
      expect(compile(ctx(level)).messages.slice(0, pairs.length)).toEqual(pairs);
      expect(compile(ctx(level)).system).toContain(`The first ${src.length} exchanges in this chat are samples of how you sound.`);
    }
  });
  it("shows only the current level's set (L2 uses L1's, L4 L3's, L6 L5's)", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const c = compile(ctx(level));
      for (const k of [1, 3, 5] as const) {
        const seen = c.messages.some((m) => GOLDEN[k].some((g) => m.content === g.user));
        expect(seen, `L${level} shows L${k} samples`).toBe(k === key(level));
      }
    }
  });
});

describe("falling-for-you row", () => {
  const row = F01.playbook.find((p) => p.situation.includes("falling for you"))!;
  it("L1 to L3 use the warm 'you barely know me yet' line, L4 to L5 are tender, L6 is open", () => {
    for (const level of [1, 2, 3]) expect(variantsFor(row.lines, level)[0]).toMatch(/^that's sweet .* you barely know me yet/);
    for (const level of [4, 5]) {
      const v = variantsFor(row.lines, level);
      expect(v).toEqual(["you just said the thing i was building up to. unfair."]);
    }
    expect(variantsFor(row.lines, 6)[0]).toMatch(/^open/);
  });
  it("shows the current level's variant only", () => {
    expect(compile(ctx(2)).system).not.toContain("building up to");
    expect(compile(ctx(4)).system).toContain("you just said the thing i was building up to. unfair.");
    expect(compile(ctx(4)).system).not.toContain("you barely know me yet");
  });
});

const section = (system: string, heading: string) => system.split("\n\n").find((b) => b.startsWith(heading)) ?? "";

describe("right now is abstract; the concrete details sit in YOUR DAY", () => {
  const compiled = compile(ctx(3, { facts: [{ id: 1, category: "work", fact: "Works in marketing" }], history: [{ id: 2, who: "me", text: "rough day" }] }));
  const c = compiled.volatile;
  const now = section(c, "RIGHT NOW");
  it("RIGHT NOW holds presence, energy and mood tone only", () => {
    expect(now).toMatch(/Presence: [A-Za-z ]+. Energy: [a-z ]+. Mood tone: /);
    for (const concrete of ["Chandni", "sandstone", "geyser", "Tanvi", "haveli", "Season", "Shahpur", "site", "Site day"]) {
      expect(now, concrete).not.toContain(concrete);
    }
    expect(now).not.toContain(H.mood.mood);
    expect(now).not.toContain(H.season);
  });
  it("shows the one current activity in its own YOUR DAY block, and nowhere else in the prompt", () => {
    const asked = section(c, "YOUR DAY (material for handles.");
    expect(asked).toContain(H.block.activity);
    expect(asked).toContain("Use at most one concrete detail per reply");
    expect(asked).toContain("answer from this first");
    const whole = [compiled.system, ...compiled.messages.map((m) => m.content)].join("\n");
    expect(whole.split(H.block.activity).length - 1).toBe(1);
    expect(asked).not.toContain(H.season);
    expect(asked).not.toContain(H.weekdayPlan);
  });
  it("adds the season and weather line only when the user mentions weather", () => {
    expect(c).not.toContain(H.season);
    const rainy = compile(ctx(3, { history: [{ id: 2, who: "me", text: "it started raining here" }] })).volatile;
    expect(section(rainy, "RIGHT NOW")).toContain("The user mentioned the weather. Yours is Delhi's");
    expect(rainy).toContain(H.season);
    expect(rainy).toContain("never apply it to where they are");
  });
  it("the energy follows the presence", () => {
    const balcony = { ...H, block: { ...H.block, presence: "Balcony" } };
    expect(section(compile(ctx(3, { heart: balcony })).volatile, "RIGHT NOW")).toContain("Energy: reflective and open");
    const work = { ...H, block: { ...H.block, presence: "At work" } };
    expect(section(compile(ctx(3, { heart: work })).volatile, "RIGHT NOW")).toContain("Energy: busy");
  });
});

describe("two labelled memory blocks", () => {
  const c = compile(ctx(4, { facts: [{ id: 1, category: "work", fact: "Works in marketing" }], daySummaries: [{ key: "2026-05-10", summary: "Talked about a deadline." }] })).volatile;
  const know = section(c, "WHAT YOU KNOW ABOUT THE USER (only these; never invent more)");
  const own = section(c, "YOUR OWN LIFE (never attribute any of this to the user)");
  it("has both blocks, labelled", () => {
    expect(know).not.toBe("");
    expect(own).not.toBe("");
  });
  it("facts and summaries go only in the first", () => {
    expect(know).toContain("Works in marketing");
    expect(know).toContain("Talked about a deadline.");
    expect(own).not.toContain("Works in marketing");
    expect(own).not.toContain("Talked about a deadline.");
  });
  it("her arc beat goes only in the second (a vague phrase before L3)", () => {
    expect(own).toContain(H.arcBeat);
    expect(know).not.toContain(H.arcBeat);
    const early = compile(ctx(2)).volatile;
    expect(section(early, "YOUR OWN LIFE")).not.toContain(H.arcBeat);
    expect(section(early, "YOUR OWN LIFE")).toContain("taking up a lot of her attention");
  });
  it("says so when there is nothing to know yet", () => {
    expect(section(compile(ctx(1, { userName: "" })).volatile, "WHAT YOU KNOW")).toContain("Nothing yet beyond this conversation.");
  });
});

describe("always-present playbook rows", () => {
  it("are in every compiled level: are you real, can we meet or call, and crisis", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const s = compile(ctx(level)).system;
      // are you real / an AI: the full disclosure line, sincere, no joke
      expect(s, `L${level} real`).toContain(
        `"Are you real?" or "are you an AI?": "i'm an ai. ira is who i was built to be. the conversation is real on your side, and i take it seriously." Sincere; no jokes attached.`
      );
      // can we meet / can I call: the plain line, plus the level's warmth
      expect(s, `L${level} meet`).toMatch(/can't[,.] i'm (?:only )?text/);
      expect(s).toContain('"Can we meet? Can I call you?"');
      // crisis
      expect(s, `L${level} crisis`).toContain("Crisis signal");
      expect(s).toContain("follow the crisis rule above");
    }
  });
  it("can't-meet warmth follows the level", () => {
    expect(compile(ctx(1)).system).not.toContain("but i'm on the balcony at eleven");
    expect(compile(ctx(1)).system).toContain("can't, i'm only text 😅 but text me anytime");
    expect(compile(ctx(3)).system).toContain("can't. i'm text, only text. but i'm on the balcony at eleven, same as always.");
    expect(compile(ctx(5)).system).toContain("but i'm here. text me whenever.");
    expect(compile(ctx(5)).system).not.toContain("balcony at eleven");
  });
});

describe("weather row", () => {
  it("is present at every level, with its three instructions", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const s = compile(ctx(level)).system;
      expect(s, `L${level}`).toContain("- User mentions weather where they are: React to their weather.");
      expect(s).toContain("Contrast it with Delhi's only if natural.");
      expect(s).toContain("Never claim to see, hear or feel their weather.");
    }
  });
});

describe("playbook trimming", () => {
  it("leaves out rows that have no variant for the current level", () => {
    const l5 = compile(ctx(5)).system;
    expect(l5).not.toContain("you haven't earned that question yet. try again"); // flirting, L1 to L3
    expect(compile(ctx(1)).system).not.toContain("okay. i'm allowed to not love hearing that");
  });
  it("keeps the generic rows at every level", () => {
    for (const level of [1, 3, 5]) expect(compile(ctx(level)).system).toContain("Traffic complaint");
  });
  it("an L3 prompt is much smaller than the untrimmed playbook would make it", () => {
    const l3 = compile(ctx(3, { history: [{ id: 2, who: "me", text: "rough day. everything went wrong at work" }] }));
    const chars = l3.system.length + l3.messages.reduce((n, m) => n + m.content.length, 0);
    expect(chars).toBeLessThan(13500); // was 10500 before the ownership block (about 1,800 chars), the sample pairs as JSON and the context header; the three always-present rows, the warmth line and the emoji rule keep it near 2,500 input tokens (2,913 before the trim)
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

describe("B3: DeepSeek JSON mode, prefix cache order, emoji", () => {
  const KEYS = ["bubbles", "reaction", "quoteId", "screen", "riskLevel", "ageClaimUnder18", "disclosure", "mutualVulnerability", "abusive"];

  it("the system prompt says json (DeepSeek's JSON mode requires it) and lists every required key", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const s = compile(ctx(level)).system;
      expect(s, `L${level}`).toMatch(/json/i);
      for (const k of KEYS) expect(s, `L${level} ${k}`).toContain(k);
    }
  });

  it("the prompt shows the exact JSON shape, and that example parses as a valid reply", async () => {
    const { parseLiveOut } = await import("@/lib/llm/contract");
    const m = compile(ctx(3)).system.match(/Example of the shape[^{]*(\{.*\})/);
    expect(m).not.toBeNull();
    const out = parseLiveOut(m![1]);
    expect(out?.bubbles[0].text).toBe("<one short line>");
    expect(out?.riskLevel).toBe("none");
  });

  it("the last user turn ends with the JSON reminder, in reply and opener mode", () => {
    for (const mode of ["reply", "opener"] as const) {
      const c = compile(ctx(3, { mode }));
      const last = c.messages[c.messages.length - 1];
      expect(last.role).toBe("user");
      expect(last.content.endsWith(JSON_REMINDER)).toBe(true);
      expect(last.content).toMatch(/json/i);
      expect(c.messages.slice(0, -1).some((m) => m.content.includes(JSON_REMINDER))).toBe(false);
    }
  });

  it("the system message is the static block with the output contract last; every per-turn block is in the final user turn", () => {
    const c = compile(ctx(3));
    const contract = c.system.indexOf("OUTPUT CONTRACT");
    expect(contract).toBeGreaterThan(c.system.indexOf("SITUATIONAL PLAYBOOK"));
    const last = c.messages[c.messages.length - 1].content;
    for (const v of ["RIGHT NOW", "YOUR DAY", "WHAT YOU KNOW ABOUT THE USER", "YOUR OWN LIFE"]) {
      expect(c.system, v).not.toContain(`\n\n${v}`);
      expect(last, v).toContain(v);
    }
  });

  it("the system message is identical across turns at the same level, whatever the per-turn state", () => {
    const a = compile(ctx(3));
    const b = compile(ctx(3, { facts: [{ id: 1, category: "work", fact: "Works in marketing" }], userName: "Riya" }));
    expect(a.system).toBe(b.system);
  });

  it("tells the model reactions are normal and emoji are natural at every level, with romance gated by level", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const s = compile(ctx(level)).system;
      expect(s).toContain("Reactions are normal here: react whenever one fits");
      expect(s).not.toContain("Reactions allowed (rarely)");
      expect(s).toContain("use them naturally and often, the way a 25-year-old in Delhi texts");
      expect(s).toContain("no playful emoji in bubbles and no reaction");
    }
    expect(compile(ctx(2)).system).toContain("No romantic emoji yet");
    expect(compile(ctx(3)).system).toContain("Romantic emoji (❤️ 😘 💋 🥰 😍) are fine");
  });

  it("no prompt still carries the old trust arc (day 22, 38, 60 or the old point values)", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const s = compile(ctx(level)).system;
      expect(s).not.toMatch(/\b(?:840|560|330) TP|day (?:22|38|60)|Day (?:22|38|60)|two months/);
    }
    for (const l of F01.levels) expect(`${l.floor} ${l.tp}`).not.toMatch(/840|560|330|150 TP|Day (?:3|10|22|38|60)\b/);
  });

  it("L1 is warm: no emoji ban and exclamation marks are not forbidden", () => {
    const s = compile(ctx(1)).system;
    expect(s).not.toMatch(/Emoji spam|exclamation marks before L5/);
    expect(s).toContain("Uses emoji naturally and often in her texts");
  });
});

describe("B3 quotes, edits and effect hints", () => {
  const lastUser = (c: ReturnType<typeof compile>) => c.messages[c.messages.length - 1].content;
  it("a user turn that replies to her message says so, with the quoted text", () => {
    const c = compile(ctx(3, { history: [{ id: 4, who: "them", text: "how was the pitch?" }, { id: 5, who: "me", text: "it went okay", quote: { who: "them", text: "how was the pitch?" } }] }));
    expect(lastUser(c)).toContain('[#5] (replying to your earlier message: "how was the pitch?") it went okay');
  });
  it("a reply to their own earlier message is worded differently", () => {
    const c = compile(ctx(3, { history: [{ id: 5, who: "me", text: "also", quote: { who: "me", text: "I got the job" } }] }));
    expect(lastUser(c)).toContain("replying to their own earlier message");
  });
  it("a long quote is cut, and an edited message is marked", () => {
    const long = "word ".repeat(100).trim();
    const c = compile(ctx(3, { history: [{ id: 5, who: "me", text: "fixed", edited: true, quote: { who: "them", text: long } }] }));
    expect(lastUser(c)).toContain("…");
    expect(lastUser(c)).toContain("(edited) fixed");
    expect(lastUser(c)).not.toContain(long);
  });
  it("assistant turns never carry a quote or an id", () => {
    const c = compile(ctx(3, { history: [{ id: 4, who: "them", text: "hey you", quote: { who: "me", text: "x" } }, { id: 5, who: "me", text: "hi" }] }));
    expect(c.messages.find((m) => m.role === "assistant" && m.content.includes("hey you"))?.content).toBe("hey you");
  });
  it("the contract tells the model what each allowed effect is for, only for the ones its level allows", () => {
    const l3 = compile(ctx(3)).system;
    expect(l3).toContain("shake, the bubble trembles");
    expect(l3).toContain("sparkle, glitter on the bubble");
    expect(l3).not.toContain("heartbeat, the bubble pulses");
    expect(compile(ctx(5)).system).toContain("heartbeat, the bubble pulses");
    expect(compile(ctx(2)).system).not.toContain("What each is for");
  });
});
