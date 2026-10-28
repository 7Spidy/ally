import { describe, it, expect, vi } from "vitest";
import { F01, paletteFor } from "@/personas/persona";
import { LIVE_OUT_SCHEMA, cutAtSentence, cutAtWord, grantCelebration, applyQaForce, EFFECT_TOTAL_DAILY_CAP, EFFECTS, EFFECT_MIN_LEVEL, parseLiveOut, safePrefix, sanitize, bubbleMeta, type LiveOut, type SanitizeCtx } from "@/lib/llm/contract";

function out(over: Partial<LiveOut> = {}): LiveOut {
  return {
    reaction: null,
    quoteId: null,
    bubbles: [{ text: "hello there", effect: null }],
    screen: null,
    riskLevel: "none",
    ageClaimUnder18: false,
    disclosure: false,
    mutualVulnerability: false,
    abusive: false,
    ...over,
  };
}

function ctx(over: Partial<SanitizeCtx> = {}): SanitizeCtx {
  return {
    level: 3,
    latestMeId: 10,
    quotableIds: [2, 4, 10],
    effectsToday: {},
    screensToday: 0,
    pinInLast30d: false,
    milestone: null,
    quiet: false,
    persona: F01,
    ...over,
  };
}

const b = (text: string, effect: LiveOut["bubbles"][number]["effect"] = null) => ({ text, effect });

describe("bubbles", () => {
  it("trims, drops empties, caps at 3", () => {
    const r = sanitize(out({ bubbles: [b("  a  "), b("   "), b("b"), b("c"), b("d")] }), ctx());
    expect(r.bubbles.map((x) => x.text)).toEqual(["a", "b", "c"]);
  });
  it("L1 keeps exactly one bubble", () => {
    const r = sanitize(out({ bubbles: [b("a"), b("b")] }), ctx({ level: 1 }));
    expect(r.bubbles).toHaveLength(1);
  });
  it("leaves a bubble of up to 280 characters alone, even past the 200 the prompt asks for", () => {
    const text = "a".repeat(279) + ".";
    expect(sanitize(out({ bubbles: [b(text)] }), ctx()).bubbles[0].text).toBe(text);
  });
  it("cuts an over-length bubble at the last sentence boundary before 280 characters", () => {
    const first = "This is the first sentence and it is fairly long. ".repeat(4).trim(); // 4 sentences, 199 chars
    const text = `${first} ${"tail words without a stop ".repeat(10)}end.`;
    const cut = sanitize(out({ bubbles: [b(text)] }), ctx()).bubbles[0].text;
    expect(cut.length).toBeLessThanOrEqual(280);
    expect(cut.endsWith("long.")).toBe(true);
    expect(text.startsWith(cut)).toBe(true);
    // the last full sentence that still fits is kept, nothing after it
    expect(cut).toBe(first);
  });
  it("falls back to a word boundary when there is no sentence end to cut at", () => {
    const r = sanitize(out({ bubbles: [b("word ".repeat(200))] }), ctx());
    expect(r.bubbles[0].text.length).toBeLessThanOrEqual(280);
    expect(r.bubbles[0].text.endsWith("word")).toBe(true);
  });
  it("treats ? and ! as sentence ends", () => {
    const text = "Is that what happened? " + "x".repeat(300);
    expect(sanitize(out({ bubbles: [b(text)] }), ctx()).bubbles[0].text).toBe("Is that what happened?");
  });
  it("splits a bubble containing line breaks into separate bubbles, effect on the first", () => {
    const r = sanitize(out({ bubbles: [b("first line\nsecond line\n\nthird line", "soft")] }), ctx({ level: 3 }));
    expect(r.bubbles.map((x) => x.text)).toEqual(["first line", "second line", "third line"]);
    expect(r.bubbles.map((x) => x.effect)).toEqual(["soft", null, null]);
  });
  it("keeps the 3-bubble cap after splitting", () => {
    const r = sanitize(out({ bubbles: [b("a\nb"), b("c\nd")] }), ctx({ level: 3 }));
    expect(r.bubbles.map((x) => x.text)).toEqual(["a", "b", "c"]);
  });
  it("keeps the L1 single-bubble rule after splitting", () => {
    const r = sanitize(out({ bubbles: [b("only this\nnot this")] }), ctx({ level: 1 }));
    expect(r.bubbles.map((x) => x.text)).toEqual(["only this"]);
  });
  it("drops blank lines, and a bubble that is only line breaks", () => {
    const r = sanitize(out({ bubbles: [b("\n\n"), b("x\n \ny")] }), ctx({ level: 3 }));
    expect(r.bubbles.map((x) => x.text)).toEqual(["x", "y"]);
  });
  it("strips an echoed [#id] prefix", () => {
    expect(sanitize(out({ bubbles: [b("[#12] hi")] }), ctx()).bubbles[0].text).toBe("hi");
  });
});

describe("reaction", () => {
  it("must be in the level's palette", () => {
    expect(sanitize(out({ reaction: "❤️" }), ctx({ level: 3 })).reaction).toBeNull();
    expect(sanitize(out({ reaction: "❤️" }), ctx({ level: 4 })).reaction).toBe("❤️");
    expect(sanitize(out({ reaction: "👀" }), ctx({ level: 1 })).reaction).toBe("👀");
    expect(sanitize(out({ reaction: "🙄" }), ctx({ level: 1 })).reaction).toBeNull();
    expect(sanitize(out({ reaction: "🙄" }), ctx({ level: 2 })).reaction).toBe("🙄");
  });
  it("logs an off-palette reaction as it nulls it, and stays silent for an allowed one", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(sanitize(out({ reaction: "❤️" }), ctx({ level: 3 })).reaction).toBeNull();
      expect(info).toHaveBeenCalledTimes(1);
      expect(JSON.parse(info.mock.calls[0][0] as string)).toEqual({ evt: "llm.reaction_dropped", level: 3, reaction: "❤️" });
      info.mockClear();
      expect(sanitize(out({ reaction: "👀" }), ctx({ level: 1 })).reaction).toBe("👀");
      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
    }
  });
  it("is not frequency-limited: the same reaction survives reply after reply", () => {
    for (let i = 0; i < 10; i++) {
      for (const level of [1, 2, 3, 6]) expect(sanitize(out({ reaction: "😂" }), ctx({ level })).reaction).toBe("😂");
    }
  });
  it("each level's palette is a superset of the one below, and L1 is warm", () => {
    for (let level = 2; level <= 6; level++) {
      for (const e of paletteFor(level - 1, F01)) expect(paletteFor(level, F01), `L${level} keeps ${e}`).toContain(e);
    }
    expect(paletteFor(1, F01)).toEqual(["👍", "👀", "😂", "😊", "🙈", "🤔", "✨", "😅"]);
    expect(paletteFor(2, F01)).toEqual(expect.arrayContaining(["🙄", "🤭"]));
    expect(paletteFor(3, F01)).toEqual(expect.arrayContaining(["🫠", "☕"]));
    expect(paletteFor(1, F01)).not.toContain("❤️");
  });
  it("is stripped in a safety band, except 👀", () => {
    expect(sanitize(out({ reaction: "😂", riskLevel: "concern" }), ctx()).reaction).toBeNull();
    expect(sanitize(out({ reaction: "👀", riskLevel: "acute" }), ctx()).reaction).toBe("👀");
  });
});

describe("cutting never splits an emoji", () => {
  it("safePrefix backs off a surrogate pair at the boundary", () => {
    const t = "ab😂cd"; // 😂 is two UTF-16 units at index 2..3
    expect(safePrefix(t, 3)).toBe("ab");
    expect(safePrefix(t, 4)).toBe("ab😂");
    expect(safePrefix(t, 10)).toBe(t);
  });
  it("safePrefix keeps a ZWJ sequence whole", () => {
    const family = "👨‍👩‍👧"; // 8 UTF-16 units, one grapheme
    const t = `hi ${family} yo`;
    expect(safePrefix(t, 3 + family.length - 1)).toBe("hi ");
    expect(safePrefix(t, 3 + family.length)).toBe(`hi ${family}`);
  });
  it("an emoji at the 280 boundary is dropped whole, with no lone surrogate left behind", () => {
    const text = "a".repeat(279) + "😂 and then some more words";
    const bubble = sanitize(out({ bubbles: [b(text)] }), ctx()).bubbles[0].text;
    expect(bubble.length).toBeLessThanOrEqual(280);
    expect(bubble).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    expect(cutAtWord("a".repeat(279) + "😂xyz", 280)).not.toMatch(/[\ud800-\udbff]$/);
    expect(cutAtSentence("x".repeat(279) + "👨‍👩‍👧 end", 285)).not.toMatch(/\u200d$/);
  });
});

describe("quote", () => {
  it("must be an earlier me message, never the latest", () => {
    expect(sanitize(out({ quoteId: 4 }), ctx()).quoteId).toBe(4);
    expect(sanitize(out({ quoteId: 10 }), ctx()).quoteId).toBeNull();
    expect(sanitize(out({ quoteId: 99 }), ctx()).quoteId).toBeNull();
  });
});

describe("effects", () => {
  it("unlock by level", () => {
    const cases: [LiveOut["bubbles"][number]["effect"], number][] = [
      ["soft", 3],
      ["loud", 3],
      ["stop", 3],
      ["ink", 4],
    ];
    for (const [e, lvl] of cases) {
      expect(sanitize(out({ bubbles: [b("x", e)] }), ctx({ level: lvl - 1 })).bubbles[0].effect).toBeNull();
      expect(sanitize(out({ bubbles: [b("x", e)] }), ctx({ level: lvl })).bubbles[0].effect).toBe(e);
    }
    expect(sanitize(out({ bubbles: [b("x", "pin")] }), ctx({ level: 4 })).bubbles[0].effect).toBeNull();
    expect(sanitize(out({ bubbles: [b("x", "pin")] }), ctx({ level: 5 })).bubbles[0].effect).toBe("pin");
  });

  it("daily caps: soft 2, loud 1, stop 1, ink 1, counted from stored meta and this reply", () => {
    const r = sanitize(out({ bubbles: [b("a", "soft"), b("b", "soft"), b("c", "soft")] }), ctx({ level: 4, effectsToday: { soft: 1 } }));
    expect(r.bubbles.map((x) => x.effect)).toEqual(["soft", null, null]);
    expect(sanitize(out({ bubbles: [b("a", "loud")] }), ctx({ level: 4, effectsToday: { loud: 1 } })).bubbles[0].effect).toBeNull();
    expect(sanitize(out({ bubbles: [b("a", "stop")] }), ctx({ level: 4, effectsToday: { stop: 1 } })).bubbles[0].effect).toBeNull();
    expect(sanitize(out({ bubbles: [b("a", "ink")] }), ctx({ level: 4, effectsToday: { ink: 1 } })).bubbles[0].effect).toBeNull();
  });

  it("pin is once per 30 days", () => {
    expect(sanitize(out({ bubbles: [b("a", "pin")] }), ctx({ level: 5, pinInLast30d: true })).bubbles[0].effect).toBeNull();
    const r = sanitize(out({ bubbles: [b("a", "pin"), b("b", "pin")] }), ctx({ level: 5 }));
    expect(r.bubbles.map((x) => x.effect)).toEqual(["pin", null]);
  });

  it("screen effects need a matching milestone, L5+, one a day; petals only at L6", () => {
    const confetti = { kind: "birthday" as const, screen: "confetti" as const, note: "" };
    const petals = { kind: "level6" as const, screen: "petals" as const, note: "" };
    expect(sanitize(out({ screen: "confetti" }), ctx({ level: 5 })).screen).toBeNull();
    expect(sanitize(out({ screen: "confetti" }), ctx({ level: 4, milestone: confetti })).screen).toBeNull();
    expect(sanitize(out({ screen: "confetti" }), ctx({ level: 5, milestone: confetti })).screen).toBe("confetti");
    expect(sanitize(out({ screen: "rain" }), ctx({ level: 5, milestone: confetti })).screen).toBeNull();
    expect(sanitize(out({ screen: "confetti" }), ctx({ level: 5, milestone: confetti, screensToday: 1 })).screen).toBeNull();
    expect(sanitize(out({ screen: "petals" }), ctx({ level: 5, milestone: petals })).screen).toBeNull();
    expect(sanitize(out({ screen: "petals" }), ctx({ level: 6, milestone: petals })).screen).toBe("petals");
  });

  it("a `screen` bubble effect survives only with a screen", () => {
    const m = { kind: "diwali" as const, screen: "lanterns" as const, note: "" };
    expect(sanitize(out({ bubbles: [b("x", "screen")] }), ctx({ level: 5 })).bubbles[0].effect).toBeNull();
    expect(sanitize(out({ screen: "lanterns", bubbles: [b("x", "screen")] }), ctx({ level: 5, milestone: m })).bubbles[0].effect).toBe("screen");
  });

  it("L1 effects never survive", () => {
    const r = sanitize(out({ reaction: "❤️", bubbles: [b("x", "loud")], screen: "confetti" }), ctx({ level: 1 }));
    expect(r.bubbles[0].effect).toBeNull();
    expect(r.screen).toBeNull();
    expect(r.reaction).toBeNull(); // romantic reactions are not in the L1 palette
  });

  it("level-up to L6 grants petals server-side, once a day, never in a safety band", () => {
    const base = out();
    const g = (over: Partial<Parameters<typeof grantCelebration>[1]> = {}) => grantCelebration(base, { level: 6, leveledUp: 6, milestone: null, screensToday: 0, band: "none", ...over });
    expect(g().screen).toBe("petals");
    expect(g({ screensToday: 1 }).screen).toBeNull();
    expect(g({ level: 5, leveledUp: null }).screen).toBeNull();
    expect(g({ band: "acute" }).screen).toBeNull();
  });
  it("each level-up earns its own screen, below L5 too", () => {
    const g = (level: number) => grantCelebration(out(), { level, leveledUp: level, milestone: null, screensToday: 0, band: "none" }).screen;
    expect([g(2), g(3), g(4), g(5), g(6)]).toEqual([null, "sparkles", "shootingstar", "fireworks", "petals"]);
  });
  it("the 100th message grants balloons even at L1, but never over a screen the model already chose", () => {
    const m = { kind: "msg100" as const, screen: "balloons" as const, note: "x" };
    expect(grantCelebration(out(), { level: 1, leveledUp: null, milestone: m, screensToday: 0, band: "none" }).screen).toBe("balloons");
    expect(grantCelebration(out({ screen: "confetti" }), { level: 5, leveledUp: null, milestone: m, screensToday: 0, band: "none" }).screen).toBe("confetti");
    expect(grantCelebration(out(), { level: 1, leveledUp: null, milestone: m, screensToday: 1, band: "none" }).screen).toBeNull();
  });
});

describe("the wider effect palette", () => {
  it("every effect has a level gate, and the new ones sit where the spec puts them", () => {
    for (const e of EFFECTS) expect(EFFECT_MIN_LEVEL[e]).toBeGreaterThanOrEqual(3);
    expect([EFFECT_MIN_LEVEL.shake, EFFECT_MIN_LEVEL.sparkle, EFFECT_MIN_LEVEL.echo, EFFECT_MIN_LEVEL.bloom, EFFECT_MIN_LEVEL.heartbeat]).toEqual([3, 3, 4, 4, 5]);
  });
  it("a new effect below its level is dropped", () => {
    expect(sanitize(out({ bubbles: [b("x", "heartbeat")] }), ctx({ level: 4 })).bubbles[0].effect).toBeNull();
    expect(sanitize(out({ bubbles: [b("x", "heartbeat")] }), ctx({ level: 5 })).bubbles[0].effect).toBe("heartbeat");
    expect(sanitize(out({ bubbles: [b("x", "echo")] }), ctx({ level: 3 })).bubbles[0].effect).toBeNull();
  });
  it("each new effect obeys its own daily cap", () => {
    expect(sanitize(out({ bubbles: [b("x", "shake")] }), ctx({ level: 3, effectsToday: { shake: 1 } })).bubbles[0].effect).toBeNull();
    expect(sanitize(out({ bubbles: [b("x", "sparkle")] }), ctx({ level: 3, effectsToday: { sparkle: 1 } })).bubbles[0].effect).toBe("sparkle");
    expect(sanitize(out({ bubbles: [b("x", "sparkle")] }), ctx({ level: 3, effectsToday: { sparkle: 2 } })).bubbles[0].effect).toBeNull();
  });
  it(`all capped effects together stop at ${EFFECT_TOTAL_DAILY_CAP} a day`, () => {
    const used = { soft: 2, loud: 1, shake: 1 }; // 4 already
    expect(sanitize(out({ bubbles: [b("x", "sparkle")] }), ctx({ level: 5, effectsToday: used })).bubbles[0].effect).toBeNull();
    expect(sanitize(out({ bubbles: [b("x", "sparkle")] }), ctx({ level: 5, effectsToday: { soft: 2, loud: 1 } })).bubbles[0].effect).toBe("sparkle");
  });
  it("within one reply the total cap counts the bubbles already accepted", () => {
    const r = sanitize(out({ bubbles: [b("a", "sparkle"), b("b", "sparkle"), b("c", "shake")] }), ctx({ level: 5, effectsToday: { soft: 2, loud: 1 } }));
    expect(r.bubbles.map((x) => x.effect)).toEqual(["sparkle", null, null]);
  });
});

describe("QA force", () => {
  it("sets the first bubble's effect, the screen and the reaction, ignoring level and caps", () => {
    const r = applyQaForce(out({ bubbles: [b("a"), b("b")] }), { effect: "heartbeat", screen: "fireworks", reaction: "🫶" });
    expect(r.bubbles.map((x) => x.effect)).toEqual(["heartbeat", null]);
    expect(r.screen).toBe("fireworks");
    expect(r.reaction).toBe("🫶");
  });
  it("does nothing without a force, and never mutates its input", () => {
    const base = out();
    expect(applyQaForce(base, null)).toBe(base);
    applyQaForce(base, { effect: "shake" });
    expect(base.bubbles[0].effect).toBeNull();
  });
  it("refuses an unknown effect, and the bare screen effect (it needs a screen)", () => {
    expect(applyQaForce(out(), { effect: "wiggle" as never }).bubbles[0].effect).toBeNull();
    expect(applyQaForce(out(), { effect: "screen" }).bubbles[0].effect).toBeNull();
  });
});

describe("safety and quiet stripping", () => {
  const loud = out({ reaction: "👀", screen: "confetti", bubbles: [b("x", "loud")] });
  it("quiet (cool-off or safety mode) strips every effect and the reaction", () => {
    const r = sanitize(loud, ctx({ level: 5, quiet: true }));
    expect(r.reaction).toBeNull();
    expect(r.bubbles[0].effect).toBeNull();
    expect(r.screen).toBeNull();
  });
  it("acute strips effects and keeps the reaction only if it is 👀", () => {
    expect(sanitize({ ...loud, riskLevel: "acute" }, ctx({ level: 5 })).reaction).toBe("👀");
    expect(sanitize({ ...loud, riskLevel: "acute", reaction: "☕" }, ctx({ level: 5 })).reaction).toBeNull();
    expect(sanitize({ ...loud, riskLevel: "acute" }, ctx({ level: 5 })).bubbles[0].effect).toBeNull();
  });
  it("never throws on junk", () => {
    expect(() => sanitize({ bubbles: null } as unknown as LiveOut, ctx())).not.toThrow();
  });
});

describe("parseLiveOut", () => {
  const good = JSON.stringify(out({ bubbles: [b("hi", "soft")], riskLevel: "concern", disclosure: true }));
  it("parses the object, also inside prose or fences", () => {
    expect(parseLiveOut(good)?.riskLevel).toBe("concern");
    expect(parseLiveOut("```json\n" + good + "\n```")?.disclosure).toBe(true);
    expect(parseLiveOut("Sure! " + good + " done")?.bubbles[0].text).toBe("hi");
  });
  it("rejects prose and empty bubbles", () => {
    expect(parseLiveOut("just some prose")).toBeNull();
    expect(parseLiveOut(JSON.stringify({ bubbles: [{ text: "  ", effect: null }] }))).toBeNull();
  });
  it("coerces unknown enums to safe values", () => {
    const r = parseLiveOut(JSON.stringify({ bubbles: [{ text: "x", effect: "glitterbomb" }], screen: "meteor", riskLevel: "panic" }));
    expect(r?.bubbles[0].effect).toBeNull();
    expect(r?.screen).toBeNull();
    expect(r?.riskLevel).toBe("none");
  });
});

describe("schema and prompt order", () => {
  const ORDER = ["bubbles", "reaction", "quoteId", "screen", "riskLevel", "ageClaimUnder18", "disclosure", "mutualVulnerability", "abusive"];
  it("puts bubbles first, then reaction, quoteId, screen, then the flags", () => {
    expect(LIVE_OUT_SCHEMA.required).toEqual(ORDER);
    expect(Object.keys(LIVE_OUT_SCHEMA.properties)).toEqual(ORDER);
  });
  it("names the risk field riskLevel, not safety", () => {
    expect(Object.keys(LIVE_OUT_SCHEMA.properties)).not.toContain("safety");
    expect(LIVE_OUT_SCHEMA.properties.riskLevel.enum).toEqual(["none", "concern", "acute"]);
  });
  it("still reads an old \"safety\" key from a model that uses it", () => {
    expect(parseLiveOut(JSON.stringify({ bubbles: [{ text: "x", effect: null }], safety: "acute" }))?.riskLevel).toBe("acute");
    expect(parseLiveOut(JSON.stringify({ bubbles: [{ text: "x", effect: null }], riskLevel: "concern", safety: "acute" }))?.riskLevel).toBe("concern");
  });
  it("the compiled prompt lists the keys in the same order", async () => {
    const { compile } = await import("@/lib/llm/compile");
    const heart = await import("@/lib/heart");
    const h = heart.now({ id: "c", createdAt: 0 }, 86400000 * 40, F01);
    const sys = compile({ level: 1, mode: "reply", userName: "", heart: h, milestone: null, facts: [], weekSummaries: [], daySummaries: [], history: [{ id: 1, who: "me", text: "hi" }], coolOff: false, safetyMode: false, lowEffort: false, persona: F01 }).system;
    const idx = ORDER.map((k) => sys.indexOf(k + " ("));
    expect(idx.every((i) => i > 0)).toBe(true);
    expect([...idx].sort((x, y) => x - y)).toEqual(idx);
    expect(sys).toContain('Set riskLevel to "concern" or "acute"');
    expect(sys).not.toContain("safety (");
  });
});

describe("bubbleMeta", () => {
  it("puts the quote on the first bubble and the screen on the last", () => {
    const o = out({ quoteId: 4, screen: "confetti", bubbles: [b("a", "soft"), b("b")] });
    expect(bubbleMeta(o, 0, false)).toEqual({ effect: "soft", quoteId: 4 });
    expect(bubbleMeta(o, 1, true)).toEqual({ screen: "confetti", safety: true });
  });
});
