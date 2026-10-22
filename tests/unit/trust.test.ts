import { describe, it, expect } from "vitest";
import {
  DAILY_CAP,
  DECAY_POINTS,
  DISCLOSURE_MAX_PER_DAY,
  LEVELS,
  MSG_POINTS_CAP,
  applyReply,
  decay,
  freshDay,
  freshTrust,
  relationshipDay,
  thresholdFor,
  wordCount,
  type ReplyInput,
  type TrustDay,
  type TrustState,
} from "@/lib/trust";

const DAY = 86400000;
// 2026-03-10 12:00 IST
const NOW = Date.UTC(2026, 2, 10, 6, 30);
const LONG = { words: 8, disclosure: false, mutualVulnerability: false, abusive: false };

function input(over: Partial<ReplyInput> = {}): ReplyInput {
  return { messageAt: NOW, relationshipDay: 100, ...LONG, ...over };
}
function state(over: Partial<TrustState> = {}): TrustState {
  return { ...freshTrust(), ...over };
}

describe("levels and floors", () => {
  it("each level needs its TP, its day floor, and (L4, L6) a signal", () => {
    for (const l of LEVELS) {
      const below = state({ level: l.level - 1, points: l.tp - 2, signalSinceLevel: true });
      // one long message adds +1, still below
      expect(applyReply(below, freshDay(), input({ relationshipDay: l.minDay }), NOW).state.level).toBe(l.level - 1);
      const at = state({ level: l.level - 1, points: l.tp - 1, signalSinceLevel: true });
      const up = applyReply(at, freshDay(), input({ relationshipDay: l.minDay }), NOW);
      expect(up.state.level).toBe(l.level);
      expect(up.leveledUp).toBe(l.level);
      // day floor
      const early = applyReply(at, freshDay(), input({ relationshipDay: l.minDay - 1 }), NOW);
      expect(early.state.level).toBe(l.level - 1);
      expect(early.leveledUp).toBeNull();
    }
  });

  it("L4 and L6 also need a signal; L2, L3 and L5 do not", () => {
    for (const l of LEVELS) {
      const s = state({ level: l.level - 1, points: l.tp, signalSinceLevel: false });
      const r = applyReply(s, freshDay(), input({ relationshipDay: l.minDay }), NOW);
      expect(r.state.level).toBe(l.signal ? l.level - 1 : l.level);
    }
  });

  it("mutual vulnerability sets the signal, and promotion clears it", () => {
    const s = state({ level: 3, points: 90 });
    const r = applyReply(s, freshDay(), input({ relationshipDay: 2, mutualVulnerability: true }), NOW);
    expect(r.state.level).toBe(4);
    expect(r.state.signalSinceLevel).toBe(false);
    expect(r.state.levelChangedAt).toBe(NOW);
    expect(r.state.highestLevel).toBe(4);
  });

  it("reaching L6 reports leveledUp 6", () => {
    const r = applyReply(state({ level: 5, points: 200, signalSinceLevel: true }), freshDay(), input({ relationshipDay: 6 }), NOW);
    expect(r.leveledUp).toBe(6);
  });

  it("level-ups chain: several levels in one reply when points, floors and signals allow", () => {
    // Day 4, L3, points past L5's 140, signal set: L4 consumes the signal, L5 needs none, L6 needs a new one.
    const r = applyReply(state({ level: 3, points: 150, signalSinceLevel: true }), freshDay(), input({ relationshipDay: 4 }), NOW);
    expect(r.state.level).toBe(5);
    expect(r.state.highestLevel).toBe(5);
    expect(r.leveledUp).toBe(5);
    expect(r.state.signalSinceLevel).toBe(false);
  });

  it("one signal never unlocks both L4 and L6", () => {
    const r = applyReply(state({ level: 3, points: 300, signalSinceLevel: true }), freshDay(), input({ relationshipDay: 10 }), NOW);
    expect(r.state.level).toBe(5); // L4 took the signal; L6 needs another
    const again = applyReply(r.state, r.day, input({ relationshipDay: 10, mutualVulnerability: true }), NOW);
    expect(again.state.level).toBe(6);
    expect(again.leveledUp).toBe(6);
  });

  it("a chain stops at the first level whose day floor is not met", () => {
    const r = applyReply(state({ level: 1, points: 300, signalSinceLevel: true }), freshDay(), input({ relationshipDay: 1 }), NOW);
    expect(r.state.level).toBe(3);
  });

  it("leveledUp is the highest level reached, not the first", () => {
    const r = applyReply(state({ level: 1, points: 50 }), freshDay(), input({ relationshipDay: 1 }), NOW);
    expect(r.state.level).toBe(3);
    expect(r.leveledUp).toBe(3);
  });

  it("L2 can be reached on day 0", () => {
    const r = applyReply(state({ level: 1, points: 14 }), freshDay(), input({ relationshipDay: 0 }), NOW);
    expect(r.state.level).toBe(2);
    expect(r.leveledUp).toBe(2);
  });
});

describe("points", () => {
  it("1 point for 6 or more words, 2 for 20 or more, 0 below", () => {
    expect(applyReply(state(), freshDay(), input({ words: 5 }), NOW).state.points).toBe(0);
    expect(applyReply(state(), freshDay(), input({ words: 6 }), NOW).state.points).toBe(1);
    expect(applyReply(state(), freshDay(), input({ words: 19 }), NOW).state.points).toBe(1);
    expect(applyReply(state(), freshDay(), input({ words: 20 }), NOW).state.points).toBe(2);
  });

  it("caps message points at 24 a day", () => {
    let s = state();
    let d: TrustDay = freshDay();
    for (let i = 0; i < 30; i++) {
      const r = applyReply(s, d, input({ words: 25 }), NOW);
      s = r.state;
      d = r.day;
    }
    expect(MSG_POINTS_CAP).toBe(24);
    expect(d.msgPoints).toBe(24);
    // 30 long messages: 24 message points plus the session bonus reached at message 8
    expect(s.points).toBe(28);
  });

  it("an odd cap leaves the last point to a 2-point message only up to the cap", () => {
    const d: TrustDay = { ...freshDay(), msgPoints: 23 };
    const r = applyReply(state(), d, input({ words: 40 }), NOW);
    expect(r.day.msgPoints).toBe(24);
    expect(r.state.points).toBe(1);
  });

  it("session bonus (+4) lands once a day; a disclosure is +4 up to twice; mutual vulnerability +4 once", () => {
    let s = state();
    let d: TrustDay = freshDay();
    for (let i = 0; i < 20; i++) {
      const r = applyReply(s, d, input({ words: 1, disclosure: true, mutualVulnerability: true }), NOW);
      s = r.state;
      d = r.day;
    }
    expect(d.sessionBonus).toBe(true);
    expect(d.disclosureCount).toBe(DISCLOSURE_MAX_PER_DAY);
    expect(d.vulnBonus).toBe(true);
    expect(s.points).toBe(4 + 2 * 4 + 4);
  });

  it("the third disclosure in a day earns nothing", () => {
    let s = state();
    let d: TrustDay = freshDay();
    const pts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = applyReply(s, d, input({ words: 1, disclosure: true }), NOW);
      pts.push(r.state.points - s.points);
      s = r.state;
      d = r.day;
    }
    expect(pts).toEqual([4, 4, 0]);
    expect(d.disclosureCount).toBe(2);
  });

  it("the vulnerability bonus is once a day but the signal is set every time", () => {
    const first = applyReply(state(), freshDay(), input({ words: 1, mutualVulnerability: true }), NOW);
    expect(first.state.points).toBe(4);
    expect(first.state.signalSinceLevel).toBe(true);
    const second = applyReply({ ...first.state, signalSinceLevel: false }, first.day, input({ words: 1, mutualVulnerability: true }), NOW);
    expect(second.state.points).toBe(4);
    expect(second.state.signalSinceLevel).toBe(true);
  });

  it("the daily cap of 40 holds, and every award respects the room left", () => {
    expect(DAILY_CAP).toBe(40);
    let s = state();
    let d: TrustDay = freshDay();
    for (let i = 0; i < 60; i++) {
      const r = applyReply(s, d, input({ words: 30, disclosure: true, mutualVulnerability: true }), NOW);
      s = r.state;
      d = r.day;
    }
    expect(s.points).toBe(40);
    const near: TrustDay = { msgPoints: 24, sessionBonus: true, disclosureCount: 2, vulnBonus: false, userMsgs: 30 };
    const r = applyReply(state({ points: 36 }), near, input({ words: 30, mutualVulnerability: true }), NOW);
    expect(r.state.points).toBe(40); // the vulnerability bonus fits exactly
    expect(r.day.vulnBonus).toBe(true);
    const full = applyReply(state({ points: 40 }), { ...near, vulnBonus: true }, input({ words: 30, disclosure: true }), NOW);
    expect(full.state.points).toBe(40);
  });

  it("counts every user message a reply covers toward the session bonus", () => {
    const r = applyReply(state(), freshDay(), input({ userMsgs: 8 }), NOW);
    expect(r.day.sessionBonus).toBe(true);
  });
});

describe("pace: L6 in about a week", () => {
  const DAYMS = DAY;
  /** One IST day of a user: long messages, 2 disclosures, a vulnerability signal, 8+ messages. */
  function playDay(s: TrustState, relDay: number, quality: "high" | "short", msgs = 30): TrustState {
    let d: TrustDay = freshDay();
    const at = NOW + relDay * DAYMS;
    for (let i = 0; i < msgs; i++) {
      const r = applyReply(
        s,
        d,
        input({ messageAt: at, relationshipDay: relDay, words: quality === "high" ? 25 : 3, disclosure: quality === "high" && i < 2, mutualVulnerability: quality === "high" && i === 3 }),
        at
      );
      s = r.state;
      d = r.day;
    }
    return s;
  }

  it("a high-quality chatter reaches L6 on relationship day 6 and not earlier", () => {
    let s = state();
    const levels: number[] = [];
    for (let day = 0; day <= 6; day++) {
      s = playDay(s, day, "high");
      levels.push(s.level);
    }
    expect(levels[5]).toBeLessThan(6); // day 5
    expect(levels[6]).toBe(6); // day 6
    expect(s.points).toBeGreaterThanOrEqual(200);
  });

  it("level-ups are possible on day 0", () => {
    const s = playDay(state(), 0, "high");
    expect(s.level).toBeGreaterThanOrEqual(2);
  });

  it("3-word messages for 7 days stay at L1, earning nothing", () => {
    let s = state();
    for (let day = 0; day < 7; day++) s = playDay(s, day, "short", 7);
    expect(s.level).toBe(1);
    expect(s.points).toBe(0);
  });

  it("padding a day with 8+ short messages earns only the session bonus (4 a day), nowhere near L3", () => {
    let s = state();
    for (let day = 0; day < 7; day++) s = playDay(s, day, "short", 30);
    expect(s.points).toBe(28);
    expect(s.level).toBe(2);
  });
});

describe("abuse", () => {
  it("drops one level, sets a 48h cool-off, and awards nothing", () => {
    const r = applyReply(state({ level: 3, points: 200 }), freshDay(), input({ abusive: true }), NOW);
    expect(r.state.level).toBe(2);
    expect(r.dropped).toBe(true);
    expect(r.state.coolOffUntil).toBe(NOW + 2 * DAY);
    expect(r.state.points).toBe(200);
    expect(r.state.lastDropAt).toBe(NOW);
  });

  it("never drops below 1", () => {
    const r = applyReply(state({ level: 1 }), freshDay(), input({ abusive: true }), NOW);
    expect(r.state.level).toBe(1);
    expect(r.state.coolOffUntil).toBe(NOW + 2 * DAY);
  });

  it("drops at most once every 7 days but still cools off", () => {
    const recent = state({ level: 3, lastDropAt: NOW - 3 * DAY });
    const r = applyReply(recent, freshDay(), input({ abusive: true }), NOW);
    expect(r.state.level).toBe(3);
    expect(r.dropped).toBe(false);
    expect(r.state.coolOffUntil).toBe(NOW + 2 * DAY);
    const old = applyReply(state({ level: 3, lastDropAt: NOW - 7 * DAY }), freshDay(), input({ abusive: true }), NOW);
    expect(old.state.level).toBe(2);
  });
});

describe("freeze", () => {
  it("skips everything while trust is frozen", () => {
    const s = state({ level: 1, points: 14, trustFrozenUntil: NOW + 1000 });
    const r = applyReply(s, freshDay(), input({ relationshipDay: 30, disclosure: true, abusive: false }), NOW);
    expect(r.frozen).toBe(true);
    expect(r.state).toEqual(s);
    expect(r.leveledUp).toBeNull();
  });

  it("resumes once the freeze has passed", () => {
    const s = state({ points: 14, trustFrozenUntil: NOW - 1 });
    expect(applyReply(s, freshDay(), input({ relationshipDay: 3 }), NOW).state.level).toBe(2);
  });
});

describe("decay", () => {
  it("costs 2 TP after 5 idle IST days, floor 0", () => {
    const last = NOW - 5 * DAY;
    expect(DECAY_POINTS).toBe(2);
    expect(decay(state({ points: 20 }), last, NOW).points).toBe(18);
    expect(decay(state({ points: 1 }), last, NOW).points).toBe(0);
    expect(decay(state({ points: 20 }), NOW - 4 * DAY, NOW).points).toBe(20);
  });

  it("marks below_since, and clears it when TP recovers", () => {
    const s = decay(state({ level: 2, points: 10 }), NOW, NOW);
    expect(s.belowSince).toBe("2026-03-10");
    const back = decay({ ...s, points: 20 }, NOW, NOW);
    expect(back.belowSince).toBeNull();
  });

  it("demotes after 7 days below, respecting the 7-day drop limit", () => {
    const base = state({ level: 3, points: 30, belowSince: "2026-03-03" });
    const dropped = decay(base, NOW, NOW);
    expect(dropped.level).toBe(2);
    expect(dropped.lastDropAt).toBe(NOW);
    expect(dropped.belowSince).toBeNull();
    expect(decay({ ...base, belowSince: "2026-03-04" }, NOW, NOW).level).toBe(3);
    expect(decay({ ...base, lastDropAt: NOW - 2 * DAY }, NOW, NOW).level).toBe(3);
    expect(decay({ ...base, lastDropAt: NOW - 7 * DAY }, NOW, NOW).level).toBe(2);
  });

  it("level 1 has no threshold", () => {
    expect(thresholdFor(1)).toBe(0);
    expect(decay(state({ level: 1, points: 0 }), NOW - 30 * DAY, NOW).belowSince).toBeNull();
  });
});

describe("helpers", () => {
  it("relationshipDay counts IST days from the lock day", () => {
    const lock = Date.UTC(2026, 2, 1, 18, 0); // 2026-03-01 23:30 IST
    expect(relationshipDay(lock, lock)).toBe(0);
    expect(relationshipDay(lock, lock + 30 * 60000)).toBe(1); // crossed IST midnight
  });
  it("wordCount", () => {
    expect(wordCount("  a  b c ")).toBe(3);
    expect(wordCount("")).toBe(0);
  });
});
