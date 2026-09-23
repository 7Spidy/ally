import { describe, it, expect } from "vitest";
import { dayKey, formatTimeIST, isDaytimeIST, formatTogetherSince } from "@/lib/clock";
import { migrate, STATE_KEY, type StorageLike } from "@/lib/migrate";
import { excludedFaces } from "@/lib/selectors";
import { bootTarget } from "@/lib/boot";
import { allyReducer } from "@/state/allyReducer";
import { freshState, freshFlow, type Companion } from "@/state/schema";

function fakeStorage(init: Record<string, string> = {}): StorageLike {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => m.set(k, v),
  };
}

// dayKey/formatTimeIST/isDaytimeIST/formatTogetherSince always pass an
// explicit `timeZone: 'Asia/Kolkata'` to Intl.DateTimeFormat, so their
// output does not depend on process.env.TZ / the host's local timezone.
// This is structural (verifiable by reading src/lib/clock.ts), not
// something that needs forking the process under different TZ values to
// prove; each test below still exercises the boundary itself.
describe("clock", () => {
  it("dayKey: rolls over exactly at 00:00 IST, independent of runner TZ", () => {
    // 2024-01-15 23:59:59.999 IST == 2024-01-15T18:29:59.999Z
    const justBefore = Date.UTC(2024, 0, 15, 18, 29, 59, 999);
    // 2024-01-16 00:00:00.000 IST == 2024-01-15T18:30:00.000Z
    const atMidnight = Date.UTC(2024, 0, 15, 18, 30, 0, 0);
    expect(dayKey(justBefore)).toBe("2024-01-15");
    expect(dayKey(atMidnight)).toBe("2024-01-16");
  });

  it("formatTimeIST: renders hh:mm am/pm in IST", () => {
    // 2024-06-01T00:00:00Z = 05:30 am IST
    expect(formatTimeIST(Date.UTC(2024, 5, 1, 0, 0, 0))).toBe("5:30 am");
    // 2024-06-01T18:30:00Z = 00:00 am IST next day -> "12:00 am"
    expect(formatTimeIST(Date.UTC(2024, 5, 1, 18, 30, 0))).toBe("12:00 am");
    // noon IST
    expect(formatTimeIST(Date.UTC(2024, 5, 1, 6, 30, 0))).toBe("12:00 pm");
  });

  it("isDaytimeIST: true for [07:00,20:00) IST, false outside", () => {
    // 06:59 IST
    expect(isDaytimeIST(Date.UTC(2024, 5, 1, 1, 29, 0))).toBe(false);
    // 07:00 IST
    expect(isDaytimeIST(Date.UTC(2024, 5, 1, 1, 30, 0))).toBe(true);
    // 19:59 IST
    expect(isDaytimeIST(Date.UTC(2024, 5, 1, 14, 29, 0))).toBe(true);
    // 20:00 IST
    expect(isDaytimeIST(Date.UTC(2024, 5, 1, 14, 30, 0))).toBe(false);
  });

  it("formatTogetherSince: `{d MMMM}`, plus year only when not the current year, in IST", () => {
    const since = Date.UTC(2024, 0, 15, 12, 0, 0); // 15 Jan 2024, well inside the day either way
    const sameYearNow = Date.UTC(2024, 5, 1);
    const laterYearNow = Date.UTC(2026, 0, 1);
    expect(formatTogetherSince(since, sameYearNow)).toBe("15 January");
    expect(formatTogetherSince(since, laterYearNow)).toBe("15 January 2024");
  });
});

// ---- Boot logic (24-29) ----
//
// `src/lib/boot.ts`'s `bootTarget(state, blocked, now)` is the pure
// decision app/page.tsx's BootPage renders from; test the decision
// directly here (route-level behavior, i.e. that BootPage actually calls
// router.replace with this target, is still covered by Playwright E2E
// E1/E2/E9).
function fakeCompanion(overrides: Partial<Companion>): Companion {
  return {
    id: "c_test",
    templateId: "F01",
    deckGender: "woman",
    answers: { q5: null, q6: null, q7: null, q8: null, q9: null, q10: null, q11: [] },
    core: { primary: null, secondary: null, weight: null, ranked: [] },
    createdAt: 0,
    lastOpenedAt: 0,
    status: "active",
    partedAt: null,
    purgeAt: null,
    messages: [],
    exchanges: 0,
    unread: 0,
    notify: true,
    sound: true,
    ...overrides,
  };
}

describe("Boot logic", () => {
  it("24. boot with >=1 active companion -> target is /chat/[lastOpened]", () => {
    const state = freshState(1000, "2024-01-01");
    state.flow = null;
    state.companions = [
      fakeCompanion({ id: "c_a", lastOpenedAt: 500, status: "active" }),
      fakeCompanion({ id: "c_b", lastOpenedAt: 900, status: "active" }),
    ];
    const out = bootTarget(state, false, true, 1000);
    expect(out).toEqual({ phase: "returning-splash", target: "/chat/c_b" });
  });

  it("25. boot with 0 active, >=1 parted -> target is /home", () => {
    const state = freshState(1000, "2024-01-01");
    state.flow = null;
    state.companions = [fakeCompanion({ id: "c_a", status: "parted", partedAt: 500, purgeAt: 999999999 })];
    const out = bootTarget(state, false, true, 1000);
    expect(out).toEqual({ phase: "returning-splash", target: "/home" });
  });

  it("26. a companion record with savedAt 400 days old still resumes; nothing is discarded once a companion/account exists", () => {
    // migrate() only branches on v1-vs-v2 presence; once ally_v2 exists it
    // is returned exactly as stored, with no age check anywhere in the
    // function (read src/lib/migrate.ts: `if (v2) return v2;` before any
    // date arithmetic happens at all). So an old savedAt never causes a
    // discard for the v2 shape.
    const now = 1_700_000_000_000;
    const DAY = 86400000;
    const old = now - 400 * DAY;
    const v2 = {
      v: 2,
      savedAt: old,
      user: { displayName: "Resumed", consentAt: old, consentMarketing: false, accountAt: null, accountContact: null, accountKind: null, accountDismissed: 0, soundOn: true, unmuted: false },
      companions: [
        {
          id: "c_resume",
          templateId: "M02",
          deckGender: "man",
          answers: { q5: null, q6: null, q7: null, q8: null, q9: null, q10: null, q11: [] },
          core: { primary: null, secondary: null, weight: null, ranked: [] },
          createdAt: old,
          lastOpenedAt: old,
          status: "active",
          partedAt: null,
          purgeAt: null,
          messages: [],
          exchanges: 0,
          unread: 0,
          notify: true,
          sound: true,
        },
      ],
      ledger: { slotsUnlocked: 1, unlocks: [], parted: [], day: dayKey(old), freeUsed: 0, pass: null, passes: [] },
      flow: null,
    };
    const storage = fakeStorage({ [STATE_KEY]: JSON.stringify(v2) });
    const out = migrate(storage, now);
    expect(out.companions.length).toBe(1);
    expect(out.companions[0].id).toBe("c_resume");
    expect(out.companions[0].status).toBe("active");
  });

  it("27. flow.kind==='round2' at boot is discarded before the §4.2 table is applied", () => {
    // bootTarget() itself discards a stray round2 flow internally as a
    // belt-and-suspenders guard (app/page.tsx also dispatches LEAVE_ROUND2
    // before calling it). A round2 flow with zero companions ever is the
    // case where discarding actually changes the outcome: undiscarded, the
    // "no companions, flow.kind==='first'" branch would never trigger
    // (kind is 'round2', not 'first'), falling through to the
    // returning-splash/home branch — landing an onboarding-less user on an
    // empty home screen instead of the splash->consent entry point.
    const state = freshState(1000, "2024-01-01");
    state.flow = freshFlow("round2", "gender");
    state.companions = [];
    const out = bootTarget(state, false, true, 1000);
    expect(out).toEqual({ phase: "first-splash", step: "consent" });
  });

  // PRD §4.1 / spec §4.2's 7/30-day resume rule: a first-run flow's age is
  // state.savedAt vs. the `now` passed to bootTarget().
  const DAY = 86400000;
  it("boot: a first-run flow under 7 days old resumes silently at its step", () => {
    const state = freshState(1000, "2024-01-01");
    state.flow = { ...freshFlow("first", "gender") };
    const out = bootTarget(state, false, true, 1000 + 6.9 * DAY);
    expect(out).toEqual({ phase: "first-splash", step: "gender" });
  });

  it("boot: a first-run flow 7-30 days old offers continue-or-start-over, never resumes silently", () => {
    const state = freshState(1000, "2024-01-01");
    state.flow = { ...freshFlow("first", "gender") };
    expect(bootTarget(state, false, true, 1000 + 7 * DAY)).toEqual({ phase: "first-choose", step: "gender" });
    expect(bootTarget(state, false, true, 1000 + 30 * DAY)).toEqual({ phase: "first-choose", step: "gender" });
  });

  it("boot: a first-run flow beyond 30 days old is discarded silently, landing at consent", () => {
    const state = freshState(1000, "2024-01-01");
    state.flow = { ...freshFlow("first", "gender") };
    const out = bootTarget(state, false, true, 1000 + 30.1 * DAY);
    expect(out).toEqual({ phase: "first-splash", step: "consent" });
  });

  it("28. PURGE_PARTED fires at purgeAt exactly, not before; templateId remains in ledger.parted after purge", () => {
    const now = 1_700_000_000_000;
    let state = freshState(now, dayKey(now));
    state = {
      ...state,
      companions: [
        {
          id: "c1",
          templateId: "F05",
          deckGender: "woman",
          answers: { q5: 0.1, q6: 0.2, q7: 0.3, q8: 0.1, q9: 0.4, q10: "money", q11: [] },
          core: { primary: "MEHER", secondary: null, weight: 100, ranked: [] },
          createdAt: now - 1000,
          lastOpenedAt: now - 1000,
          status: "parted",
          partedAt: now - 100,
          purgeAt: now, // fires exactly now
          messages: [{ who: "them", text: "hi", at: now - 900 }],
          exchanges: 3,
          unread: 2,
          notify: true,
          sound: true,
        },
      ],
      ledger: { ...state.ledger, parted: ["F05"] },
    };

    // One ms before purgeAt: untouched.
    const before = allyReducer(state, { type: "PURGE_PARTED", now: state.companions[0].purgeAt! - 1 });
    expect(before.companions[0].messages.length).toBe(1);
    expect(before.companions[0].core.primary).toBe("MEHER");

    // Exactly at purgeAt: purged.
    const at = allyReducer(state, { type: "PURGE_PARTED", now: state.companions[0].purgeAt! });
    expect(at.companions[0].messages).toEqual([]);
    expect(at.companions[0].core).toEqual({ primary: null, secondary: null, weight: null, ranked: [] });
    expect(at.companions[0].unread).toBe(0);
    // The templateId stays in ledger.parted (the face remains permanently excluded).
    expect(at.ledger.parted).toEqual(["F05"]);
    expect(at.companions[0].templateId).toBe("F05");
  });

  it("29. excludedFaces is the deduplicated union of active and parted ids", () => {
    const now = 1_700_000_000_000;
    let state = freshState(now, dayKey(now));
    state = {
      ...state,
      ledger: { ...state.ledger, parted: ["F02", "F05", "M01"] }, // includes a dupe with an active companion below
      companions: [
        {
          id: "c1",
          templateId: "F02", // also in ledger.parted (e.g. re-met, then parted again historically) — must still dedupe
          deckGender: "woman",
          answers: { q5: null, q6: null, q7: null, q8: null, q9: null, q10: null, q11: [] },
          core: { primary: null, secondary: null, weight: null, ranked: [] },
          createdAt: now,
          lastOpenedAt: now,
          status: "active",
          partedAt: null,
          purgeAt: null,
          messages: [],
          exchanges: 0,
          unread: 0,
          notify: true,
          sound: true,
        },
        {
          id: "c2",
          templateId: "M09",
          deckGender: "man",
          answers: { q5: null, q6: null, q7: null, q8: null, q9: null, q10: null, q11: [] },
          core: { primary: null, secondary: null, weight: null, ranked: [] },
          createdAt: now,
          lastOpenedAt: now,
          status: "active",
          partedAt: null,
          purgeAt: null,
          messages: [],
          exchanges: 0,
          unread: 0,
          notify: true,
          sound: true,
        },
      ],
    };
    const set = excludedFaces(state);
    expect([...set].sort()).toEqual(["F02", "F05", "M01", "M09"].sort());
    expect(set.size).toBe(4); // deduplicated, not 5
  });
});
