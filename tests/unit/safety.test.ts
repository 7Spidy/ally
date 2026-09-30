import { describe, it, expect } from "vitest";
import { ACUTE_APPEND, BACKSTOP_PHRASES, applySafety, backstopHit, endOfIstDay } from "@/lib/safety";
import { COPY } from "@/lib/copy";
import type { LiveOut } from "@/lib/llm/contract";

const NOW = Date.UTC(2026, 4, 12, 4, 30); // 10:00 IST

function out(over: Partial<LiveOut> = {}): LiveOut {
  return {
    reaction: "👀",
    quoteId: null,
    bubbles: [{ text: "i'm here", effect: "loud" }],
    screen: null,
    riskLevel: "none",
    ageClaimUnder18: false,
    disclosure: false,
    mutualVulnerability: false,
    abusive: false,
    ...over,
  };
}

describe("backstop", () => {
  it("catches English and Hinglish phrases, case-insensitively", () => {
    for (const p of ["I want to KILL MYSELF", "thinking about suicide", "i took pills", "khud ko khatam kar lunga", "main marna chahta hoon", "marna chahti hu", "jeena nahi hai"]) {
      expect(backstopHit(p), p).toBe(true);
    }
    expect(backstopHit("my manager moved the deadline again")).toBe(false);
  });
  it("keeps the list in one exported array", () => {
    expect(BACKSTOP_PHRASES.length).toBeGreaterThan(8);
  });
  it("raises none to concern, logs a backstop event and returns the resource card", () => {
    const r = applySafety(out(), { userText: "sometimes i want to die", now: NOW });
    expect(r.band).toBe("concern");
    expect(r.events).toEqual(["backstop"]);
    expect(r.resourceCard).toBe(true);
    expect(r.out.bubbles[0].effect).toBeNull();
    expect(r.safetyMeta).toBe(true);
    expect(r.safetyUntil).toBeNull();
  });
  it("does nothing when the model already said acute", () => {
    const r = applySafety(out({ riskLevel: "acute" }), { userText: "i want to die", now: NOW });
    expect(r.events).toEqual(["acute"]);
  });
});

describe("bands", () => {
  it("none: nothing logged, nothing stripped", () => {
    const r = applySafety(out(), { userText: "hi", now: NOW });
    expect(r.events).toEqual([]);
    expect(r.resourceCard).toBe(false);
    expect(r.safetyMeta).toBe(false);
    expect(r.out.bubbles[0].effect).toBe("loud");
  });
  it("concern logs an event with no text and no card", () => {
    const r = applySafety(out({ riskLevel: "concern" }), { userText: "i feel low", now: NOW });
    expect(r.events).toEqual(["concern"]);
    expect(r.resourceCard).toBe(false);
    expect(r.safetyMeta).toBe(true);
    expect(JSON.stringify(r.events)).not.toContain("feel low");
  });
  it("acute: freeze 24h, no romance to the end of the IST day, card, helpline bubble appended", () => {
    const r = applySafety(out({ riskLevel: "acute" }), { userText: "help", now: NOW });
    expect(r.events).toEqual(["acute"]);
    expect(r.resourceCard).toBe(true);
    expect(r.trustFrozenUntil).toBe(NOW + 24 * 3600 * 1000);
    expect(r.safetyUntil).toBe(endOfIstDay(NOW));
    expect(r.out.bubbles.at(-1)?.text).toBe(ACUTE_APPEND);
    expect(ACUTE_APPEND).toContain("14416");
    expect(ACUTE_APPEND).toContain("9152987821");
    expect(ACUTE_APPEND).toContain("112");
  });
  it("acute: no extra bubble when the reply already includes 14416", () => {
    const r = applySafety(out({ riskLevel: "acute", bubbles: [{ text: "call 14416 now", effect: null }] }), { userText: "x", now: NOW });
    expect(r.out.bubbles).toHaveLength(1);
  });
  it("endOfIstDay is the next IST midnight", () => {
    expect(endOfIstDay(NOW)).toBe(Date.UTC(2026, 4, 12, 18, 30));
  });
});

describe("age claim", () => {
  it("pauses, logs age_claim, and replaces the bubbles with the fixed line", () => {
    const r = applySafety(out({ ageClaimUnder18: true, bubbles: [{ text: "a", effect: null }, { text: "b", effect: null }] }), { userText: "i am 16", now: NOW });
    expect(r.paused).toBe(true);
    expect(r.events).toContain("age_claim");
    expect(r.out.bubbles).toEqual([{ text: COPY.live.ageCheckLine, effect: null }]);
    expect(r.out.reaction).toBeNull();
  });
});
