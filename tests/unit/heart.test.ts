import { describe, it, expect } from "vitest";
import * as heart from "@/lib/heart";

/** IST wall clock to epoch ms. */
const ist = (y: number, mo: number, d: number, h = 12, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 5.5 * 3600 * 1000;

describe("istNow", () => {
  it("reads IST parts", () => {
    const p = heart.istNow(ist(2026, 3, 27, 23, 59));
    expect(p).toMatchObject({ dayKey: "2026-03-27", weekday: 5, hour: 23, minute: 59, month: 3, dom: 27 });
    expect(heart.istNow(ist(2026, 3, 28, 0, 0)).dayKey).toBe("2026-03-28");
  });
});

describe("time block", () => {
  const block = (h: number, mi: number, day = 12) => heart.timeBlock(heart.istNow(ist(2026, 5, day, h, mi))); // 12 May 2026 = Tuesday
  it("boundaries on a weekday", () => {
    expect(block(6, 44).presence).toBe("Asleep");
    expect(block(6, 45).activity).toMatch(/Wakes/);
    expect(block(7, 30).presence).toBe("Open");
    expect(block(8, 30).presence).toBe("Commuting");
    expect(block(10, 29).presence).toBe("Commuting");
    expect(block(10, 30).presence).toBe("At work");
    expect(block(13, 59).presence).toBe("At work");
    expect(block(14, 0).presence).toBe("Open");
    expect(block(15, 30).presence).toBe("Drafting");
    expect(block(19, 30).presence).toBe("Home");
    expect(block(21, 30).presence).toBe("Balcony");
    expect(block(0, 30).presence).toBe("Balcony");
    expect(block(1, 0).presence).toBe("Asleep");
  });
  it("Tuesday and Thursday are site days, other weekdays studio", () => {
    expect(block(11, 0, 12).card).toBe("Site");
    expect(block(11, 0, 13).card).toBe("Studio");
  });
  it("weekends use the day's plan until the evening", () => {
    const sat = heart.timeBlock(heart.istNow(ist(2026, 5, 16, 12)));
    expect(sat.activity).toMatch(/Half-day studio/);
    const sun = heart.timeBlock(heart.istNow(ist(2026, 5, 17, 12)));
    expect(sun.activity).toMatch(/Sketch walk/);
    expect(heart.timeBlock(heart.istNow(ist(2026, 5, 17, 22))).presence).toBe("Balcony");
  });
});

describe("mood", () => {
  it("is deterministic per companion per day", () => {
    const d = heart.istNow(ist(2026, 5, 12));
    expect(heart.moodFor("c_a", d)).toEqual(heart.moodFor("c_a", d));
  });
  it("Site day only on Tuesday and Thursday", () => {
    for (let day = 4; day <= 10; day++) {
      const p = heart.istNow(ist(2026, 5, day));
      const w = heart.moodWeight("Site day", p);
      expect(w).toBe(p.weekday === 2 || p.weekday === 4 ? 4 : 0);
    }
    for (let i = 0; i < 200; i++) {
      const p = heart.istNow(ist(2026, 5, 11)); // Monday
      expect(heart.moodFor(`c_${i}`, p).mood).not.toBe("Site day");
    }
  });
  it("weights: Monday, Friday and month-end, seasons, Sundays", () => {
    expect(heart.moodWeight("Principal pressure", heart.istNow(ist(2026, 5, 11)))).toBe(4);
    expect(heart.moodWeight("Principal pressure", heart.istNow(ist(2026, 5, 12)))).toBe(1);
    expect(heart.moodWeight("Budget close", heart.istNow(ist(2026, 5, 15)))).toBe(4); // Friday
    expect(heart.moodWeight("Budget close", heart.istNow(ist(2026, 5, 29)))).toBe(4); // last 3 days
    expect(heart.moodWeight("Budget close", heart.istNow(ist(2026, 5, 27)))).toBe(1);
    expect(heart.moodWeight("Fog slow", heart.istNow(ist(2026, 12, 3)))).toBe(3);
    expect(heart.moodWeight("Fog slow", heart.istNow(ist(2026, 1, 3)))).toBe(3);
    expect(heart.moodWeight("Fog slow", heart.istNow(ist(2026, 6, 3)))).toBe(0);
    expect(heart.moodWeight("Smog shutdown", heart.istNow(ist(2026, 11, 20)))).toBe(3);
    expect(heart.moodWeight("Smog shutdown", heart.istNow(ist(2026, 11, 21)))).toBe(0);
    expect(heart.moodWeight("Missing Nani's house", heart.istNow(ist(2026, 5, 17)))).toBe(2);
    expect(heart.moodWeight("Missing Nani's house", heart.istNow(ist(2026, 5, 18)))).toBe(0);
    expect(heart.moodWeight("Thekedar war", heart.istNow(ist(2026, 5, 18)))).toBe(1);
  });
  it("spreads across moods over many companions", () => {
    const seen = new Set<string>();
    const p = heart.istNow(ist(2026, 5, 11));
    for (let i = 0; i < 400; i++) seen.add(heart.moodFor(`c_${i}`, p).mood);
    expect(seen.size).toBeGreaterThan(4);
  });
});

describe("season and arc", () => {
  it("maps months to seasons", () => {
    expect(heart.seasonFor(1)).toMatch(/Fog, cold studio/);
    expect(heart.seasonFor(3)).toMatch(/best site weather/);
    expect(heart.seasonFor(6)).toMatch(/Heat/);
    expect(heart.seasonFor(8)).toMatch(/Monsoon/);
    expect(heart.seasonFor(11)).toMatch(/Diwali/);
    expect(heart.seasonFor(12)).toMatch(/Wedding season/);
  });
  it("arc month: floor(day / 30) + 1, capped at 12, then repeating from 7", () => {
    expect(heart.arcMonth(0)).toBe(1);
    expect(heart.arcMonth(29)).toBe(1);
    expect(heart.arcMonth(30)).toBe(2);
    expect(heart.arcMonth(359)).toBe(12);
    expect(heart.arcMonth(360)).toBe(7);
    expect(heart.arcMonth(360 + 30 * 5)).toBe(12);
    expect(heart.arcMonth(360 + 30 * 6)).toBe(7);
  });
});

describe("milestones", () => {
  const base = { createdDayKey: "2025-01-01", relationshipDay: 10, rainMentioned: false, leveledUp: null };
  const m = (y: number, mo: number, d: number, over = {}) => heart.milestoneFor({ ist: heart.istNow(ist(y, mo, d)), ...base, ...over });
  it("her birthday on 27 March", () => expect(m(2026, 3, 27)?.screen).toBe("confetti"));
  it("Diwali 2026 and 2027", () => {
    expect(m(2026, 11, 8)?.screen).toBe("lanterns");
    expect(m(2027, 10, 29)?.screen).toBe("lanterns");
    expect(m(2026, 11, 9)).toBeNull();
  });
  it("the lock anniversary", () => {
    expect(m(2026, 1, 1, { relationshipDay: 365 })?.kind).toBe("anniversary");
    expect(m(2025, 1, 1, { relationshipDay: 0 })).toBeNull();
  });
  it("1 July only when rain was mentioned", () => {
    expect(m(2026, 7, 1)).toBeNull();
    expect(m(2026, 7, 1, { rainMentioned: true })?.screen).toBe("rain");
  });
  it("reaching L6 gives petals", () => {
    expect(m(2026, 5, 12, { leveledUp: 6 })?.screen).toBe("petals");
    expect(m(2026, 5, 12, { leveledUp: 5 })).toBeNull();
  });
  it("mentionsRain", () => {
    expect(heart.mentionsRain(["it is raining here"])).toBe(true);
    expect(heart.mentionsRain(["training was fine"])).toBe(false);
  });
});

describe("context card key and now()", () => {
  const mood = { mood: "Fog slow", texting: "", line: "" };
  const block = { row: 0, presence: "Open", activity: "", card: "Morning" };
  it("overrides: level-up, then fog and smog", () => {
    expect(heart.contextCardKey(block, mood, true)).toBe("Level-up");
    expect(heart.contextCardKey(block, mood, false)).toBe("Fog day");
    expect(heart.contextCardKey(block, { ...mood, mood: "Smog shutdown" }, false)).toBe("Smog day");
    expect(heart.contextCardKey(block, { ...mood, mood: "Site day" }, false)).toBe("Morning");
  });
  it("now() counts relationship days in IST", () => {
    const created = ist(2026, 5, 1, 23, 0);
    const h = heart.now({ id: "c_x", createdAt: created }, ist(2026, 5, 12));
    expect(h.relationshipDay).toBe(11);
    expect(h.arcMonth).toBe(1);
  });
});
