import { describe, it, expect } from "vitest";
import {
  DAILY_CAP,
  LEVELS,
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
    const s = state({ level: 3, points: 330 });
    const r = applyReply(s, freshDay(), input({ relationshipDay: 22, mutualVulnerability: true }), NOW);
    expect(r.state.level).toBe(4);
    expect(r.state.signalSinceLevel).toBe(false);
    expect(r.state.levelChangedAt).toBe(NOW);
    expect(r.state.highestLevel).toBe(4);
  });

  it("promotes at most one level per reply", () => {
    const r = applyReply(state({ level: 1, points: 900, signalSinceLevel: true }), freshDay(), input(), NOW);
    expect(r.state.level).toBe(2);
  });

  it("reaching L6 reports leveledUp 6", () => {
    const r = applyReply(state({ level: 5, points: 840, signalSinceLevel: true }), freshDay(), input({ relationshipDay: 60 }), NOW);
    expect(r.leveledUp).toBe(6);
  });
});

describe("points", () => {
  it("+1 only for messages of 6 or more words", () => {
    expect(applyReply(state(), freshDay(), input({ words: 5 }), NOW).state.points).toBe(0);
    expect(applyReply(state(), freshDay(), input({ words: 6 }), NOW).state.points).toBe(1);
  });

  it("caps message points at 10 a day", () => {
    let s = state();
    let d: TrustDay = freshDay();
    for (let i = 0; i < 14; i++) {
      const r = applyReply(s, d, input(), NOW);
      s = r.state;
      d = r.day;
    }
    expect(d.msgPoints).toBe(10);
    // 14 messages: 10 points plus the session bonus reached at message 8
    expect(s.points).toBe(13);
  });

  it("session bonus (+3) and disclosure bonus (+2) each land once a day", () => {
    let s = state();
    let d: TrustDay = freshDay();
    for (let i = 0; i < 20; i++) {
      const r = applyReply(s, d, input({ disclosure: true }), NOW);
      s = r.state;
      d = r.day;
    }
    expect(d.sessionBonus).toBe(true);
    expect(d.disclosureBonus).toBe(true);
    expect(s.points).toBe(DAILY_CAP);
  });

  it("the total per day never exceeds the cap", () => {
    let d: TrustDay = { msgPoints: 10, sessionBonus: true, disclosureBonus: false, userMsgs: 30 };
    const r = applyReply(state({ points: 13 }), d, input({ disclosure: true }), NOW);
    d = r.day;
    expect(d.msgPoints + 3 + (d.disclosureBonus ? 2 : 0)).toBeLessThanOrEqual(DAILY_CAP);
    expect(r.state.points).toBe(15);
  });

  it("counts every user message a reply covers toward the session bonus", () => {
    const r = applyReply(state(), freshDay(), input({ userMsgs: 8 }), NOW);
    expect(r.day.sessionBonus).toBe(true);
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
    const s = state({ level: 1, points: 39, trustFrozenUntil: NOW + 1000 });
    const r = applyReply(s, freshDay(), input({ relationshipDay: 30, disclosure: true, abusive: false }), NOW);
    expect(r.frozen).toBe(true);
    expect(r.state).toEqual(s);
    expect(r.leveledUp).toBeNull();
  });

  it("resumes once the freeze has passed", () => {
    const s = state({ points: 39, trustFrozenUntil: NOW - 1 });
    expect(applyReply(s, freshDay(), input({ relationshipDay: 3 }), NOW).state.level).toBe(2);
  });
});

describe("decay", () => {
  it("costs 5 TP after 5 idle IST days, floor 0", () => {
    const last = NOW - 5 * DAY;
    expect(decay(state({ points: 20 }), last, NOW).points).toBe(15);
    expect(decay(state({ points: 3 }), last, NOW).points).toBe(0);
    expect(decay(state({ points: 20 }), NOW - 4 * DAY, NOW).points).toBe(20);
  });

  it("marks below_since, and clears it when TP recovers", () => {
    const s = decay(state({ level: 2, points: 30 }), NOW, NOW);
    expect(s.belowSince).toBe("2026-03-10");
    const back = decay({ ...s, points: 45 }, NOW, NOW);
    expect(back.belowSince).toBeNull();
  });

  it("demotes after 7 days below, respecting the 7-day drop limit", () => {
    const base = state({ level: 3, points: 100, belowSince: "2026-03-03" });
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
