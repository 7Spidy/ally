import { describe, it, expect } from "vitest";
import { dayLabel, differentDay, localDayNumber, timeLabel } from "@/lib/chatDates";

// Built from local-time parts so the test means the same in any time zone the runner uses.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 11, 15, 14, 30); // Sunday 15 Nov 2026

describe("dayLabel", () => {
  it("says Today for the same local day", () => {
    expect(dayLabel(at(2026, 11, 15, 0, 5), NOW)).toBe("Today");
    expect(dayLabel(at(2026, 11, 15, 23, 59), NOW)).toBe("Today");
  });

  it("says Yesterday for the day before", () => {
    expect(dayLabel(at(2026, 11, 14, 9), NOW)).toBe("Yesterday");
    expect(dayLabel(at(2026, 11, 14, 23, 59), NOW)).toBe("Yesterday");
  });

  it("names the weekday, day and month for an older day this year", () => {
    expect(dayLabel(at(2026, 11, 9, 18), NOW)).toBe("Mon 9 Nov");
    expect(dayLabel(at(2026, 1, 1, 8), NOW)).toBe("Thu 1 Jan");
  });

  it("adds the year when it is not the current one", () => {
    expect(dayLabel(at(2025, 11, 9, 18), NOW)).toBe("Sun 9 Nov 2025");
    expect(dayLabel(at(2025, 12, 31, 23, 59), at(2026, 1, 1, 0, 10))).toBe("Yesterday");
    expect(dayLabel(at(2025, 12, 30, 12), at(2026, 1, 1, 0, 10))).toBe("Tue 30 Dec 2025");
  });

  it("flips at local midnight, not 24 hours", () => {
    const justBefore = at(2026, 11, 14, 23, 59);
    const justAfter = at(2026, 11, 15, 0, 1);
    expect(dayLabel(justBefore, justAfter)).toBe("Yesterday");
    expect(dayLabel(justAfter, justAfter)).toBe("Today");
    // Twenty-three hours apart but on different days.
    expect(dayLabel(at(2026, 11, 14, 22, 0), at(2026, 11, 15, 21, 0))).toBe("Yesterday");
  });
});

describe("differentDay", () => {
  it("is false within a local day and true across midnight", () => {
    expect(differentDay(at(2026, 11, 15, 0, 0), at(2026, 11, 15, 23, 59))).toBe(false);
    expect(differentDay(at(2026, 11, 14, 23, 59), at(2026, 11, 15, 0, 0))).toBe(true);
    expect(localDayNumber(at(2026, 11, 15))).toBe(20261115);
  });
});

describe("timeLabel", () => {
  it("is 12-hour with a lower-case am or pm", () => {
    expect(timeLabel(at(2026, 11, 15, 21, 41))).toBe("9:41 pm");
    expect(timeLabel(at(2026, 11, 15, 0, 5))).toBe("12:05 am");
    expect(timeLabel(at(2026, 11, 15, 12, 0))).toBe("12:00 pm");
    expect(timeLabel(at(2026, 11, 15, 9, 3))).toBe("9:03 am");
  });
});
