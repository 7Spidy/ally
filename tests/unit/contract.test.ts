import { describe, it, expect } from "vitest";
import { grantLevelUpPetals, parseLiveOut, sanitize, bubbleMeta, type LiveOut, type SanitizeCtx } from "@/lib/llm/contract";

function out(over: Partial<LiveOut> = {}): LiveOut {
  return {
    reaction: null,
    quoteId: null,
    bubbles: [{ text: "hello there", effect: null }],
    screen: null,
    safety: "none",
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
    recentUserReactions: [false, false, false, false, false],
    effectsToday: {},
    screensToday: 0,
    pinInLast30d: false,
    milestone: null,
    quiet: false,
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
  it("cuts a long bubble at a word boundary within 400 chars", () => {
    const r = sanitize(out({ bubbles: [b("word ".repeat(200))] }), ctx());
    expect(r.bubbles[0].text.length).toBeLessThanOrEqual(400);
    expect(r.bubbles[0].text.endsWith("word")).toBe(true);
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
    expect(sanitize(out({ reaction: "😂" }), ctx({ level: 1 })).reaction).toBeNull();
  });
  it("L1 to L2: dropped if any of the last 5 user messages has one", () => {
    const recent = [false, false, false, false, true];
    expect(sanitize(out({ reaction: "👀" }), ctx({ level: 2, recentUserReactions: recent })).reaction).toBeNull();
    expect(sanitize(out({ reaction: "👀" }), ctx({ level: 2, recentUserReactions: [false, false, false, false, false, true] })).reaction).toBe("👀");
  });
  it("L3 and up: dropped if any of the last 3 has one", () => {
    expect(sanitize(out({ reaction: "👀" }), ctx({ level: 3, recentUserReactions: [false, false, true, false, false] })).reaction).toBeNull();
    expect(sanitize(out({ reaction: "👀" }), ctx({ level: 3, recentUserReactions: [false, false, false, true, true] })).reaction).toBe("👀");
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
    const r = sanitize(out({ reaction: "😂", bubbles: [b("x", "loud")], screen: "confetti" }), ctx({ level: 1 }));
    expect(r.bubbles[0].effect).toBeNull();
    expect(r.screen).toBeNull();
    expect(r.reaction).toBeNull();
  });

  it("level-up to L6 grants petals server-side, once a day, never in a safety band", () => {
    const base = out();
    expect(grantLevelUpPetals(base, { level: 6, leveledUp: 6, screensToday: 0, band: "none" }).screen).toBe("petals");
    expect(grantLevelUpPetals(base, { level: 6, leveledUp: 6, screensToday: 1, band: "none" }).screen).toBeNull();
    expect(grantLevelUpPetals(base, { level: 5, leveledUp: null, screensToday: 0, band: "none" }).screen).toBeNull();
    expect(grantLevelUpPetals(base, { level: 6, leveledUp: 6, screensToday: 0, band: "acute" }).screen).toBeNull();
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
    expect(sanitize({ ...loud, safety: "acute" }, ctx({ level: 5 })).reaction).toBe("👀");
    expect(sanitize({ ...loud, safety: "acute", reaction: "☕" }, ctx({ level: 5 })).reaction).toBeNull();
    expect(sanitize({ ...loud, safety: "acute" }, ctx({ level: 5 })).bubbles[0].effect).toBeNull();
  });
  it("never throws on junk", () => {
    expect(() => sanitize({ bubbles: null } as unknown as LiveOut, ctx())).not.toThrow();
  });
});

describe("parseLiveOut", () => {
  const good = JSON.stringify(out({ bubbles: [b("hi", "soft")], safety: "concern", disclosure: true }));
  it("parses the object, also inside prose or fences", () => {
    expect(parseLiveOut(good)?.safety).toBe("concern");
    expect(parseLiveOut("```json\n" + good + "\n```")?.disclosure).toBe(true);
    expect(parseLiveOut("Sure! " + good + " done")?.bubbles[0].text).toBe("hi");
  });
  it("rejects prose and empty bubbles", () => {
    expect(parseLiveOut("just some prose")).toBeNull();
    expect(parseLiveOut(JSON.stringify({ bubbles: [{ text: "  ", effect: null }] }))).toBeNull();
  });
  it("coerces unknown enums to safe values", () => {
    const r = parseLiveOut(JSON.stringify({ bubbles: [{ text: "x", effect: "sparkle" }], screen: "fireworks", safety: "panic" }));
    expect(r?.bubbles[0].effect).toBeNull();
    expect(r?.screen).toBeNull();
    expect(r?.safety).toBe("none");
  });
});

describe("bubbleMeta", () => {
  it("puts the quote on the first bubble and the screen on the last", () => {
    const o = out({ quoteId: 4, screen: "confetti", bubbles: [b("a", "soft"), b("b")] });
    expect(bubbleMeta(o, 0, false)).toEqual({ effect: "soft", quoteId: 4 });
    expect(bubbleMeta(o, 1, true)).toEqual({ screen: "confetti", safety: true });
  });
});
