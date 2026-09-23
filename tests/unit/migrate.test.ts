import { describe, it, expect } from "vitest";
import { migrate, isBlocked, stateKeyFor, wipeLegacy, SESSION_KEY, STATE_KEY, BLOCK_KEY, type StorageLike } from "@/lib/migrate";
import { dayKey } from "@/lib/clock";

function fakeStorage(init: Record<string, string> = {}): StorageLike & { setCalls: string[]; dump(): Record<string, string> } {
  const m = new Map(Object.entries(init));
  const setCalls: string[] = [];
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => {
      setCalls.push(k);
      m.set(k, v);
    },
    setCalls,
    dump: () => Object.fromEntries(m),
  };
}

const DAY = 86400000;

describe("migrate", () => {
  it("21. a v1 session with `locked` migrates to one active companion with matching fields", () => {
    const now = 1_700_000_000_000;
    const lockedAt = now - 3600_000;
    const savedAt = now - 60_000;
    const v1 = {
      savedAt,
      state: {
        screen: 17,
        consentAt: now - 999999,
        consentMarketing: true,
        cityRaw: "Mumbai",
        region: "West",
        deckGender: "woman",
        displayName: "Rhea",
        dob: "2000-01-01",
        age: 26,
        answers: { q5: 0.4, q6: 0.5, q7: 0.5, q8: 0.38, q9: 0.5, q10: "money", q11: ["music"] },
        core: { primary: "MEHER", secondary: null, weight: 100, ranked: [{ id: "MEHER", score: 0.9 }] },
        deckOrder: ["F01", "F02"],
        deckIndex: 1,
        deckHistory: ["F01"],
        dwell: { F01: 4000 },
        liked: ["F01"],
        expanded: [],
        poolRemoved: [],
        redraws: 0,
        canRedraw: false,
        proposed: "F01",
        proposalsSeen: 1,
        proposalMode: "single",
        locked: "F01",
        lockedAt,
        soundOn: true,
        unmuted: false,
        messages: [{ who: "them", text: "hi", at: lockedAt + 1000 }],
        exchanges: 1,
        accountDismissed: 0,
        accountAt: null,
        accountContact: null,
      },
    };
    const storage = fakeStorage({ [SESSION_KEY]: JSON.stringify(v1) });
    const out = migrate(storage, now);

    expect(out.companions.length).toBe(1);
    const c = out.companions[0];
    expect(c.templateId).toBe("F01");
    expect(c.answers).toEqual(v1.state.answers);
    expect(c.core).toEqual(v1.state.core);
    expect(c.deckGender).toBe("woman");
    expect(c.messages).toEqual(v1.state.messages);
    expect(c.exchanges).toBe(1);
    expect(c.createdAt).toBe(lockedAt);
    expect(c.lastOpenedAt).toBe(savedAt);
    expect(c.status).toBe("active");
    expect(out.ledger.slotsUnlocked).toBe(1);
    expect(out.flow).toBeNull();
  });

  it("21b. createdAt falls back to savedAt when lockedAt is absent", () => {
    const now = 1_700_000_000_000;
    const savedAt = now - 60_000;
    const v1 = {
      savedAt,
      state: {
        screen: 17,
        consentAt: null,
        consentMarketing: false,
        cityRaw: "",
        region: null,
        deckGender: "man",
        displayName: "",
        dob: null,
        age: null,
        answers: { q5: null, q6: null, q7: null, q8: null, q9: null, q10: null, q11: [] },
        core: { primary: null, secondary: null, weight: null, ranked: [] },
        deckOrder: [],
        deckIndex: 0,
        deckHistory: [],
        dwell: {},
        liked: [],
        expanded: [],
        poolRemoved: [],
        redraws: 0,
        canRedraw: false,
        proposed: null,
        proposalsSeen: 0,
        proposalMode: null,
        locked: "M01",
        lockedAt: null,
        soundOn: true,
        unmuted: false,
        messages: [],
        exchanges: 0,
        accountDismissed: 0,
        accountAt: null,
        accountContact: null,
      },
    };
    const storage = fakeStorage({ [SESSION_KEY]: JSON.stringify(v1) });
    const out = migrate(storage, now);
    expect(out.companions[0].createdAt).toBe(savedAt);
  });

  it("22. a v1 session without `locked` migrates to flow.kind==='first' at the equivalent step", () => {
    const now = 1_700_000_000_000;
    const cases: [number, string][] = [
      [0, "consent"],
      [3, "gender"],
      [6, "questions/disclosure"],
      [11, "questions/pressure"],
      [13, "matching"],
      [14, "deck"],
      [16, "proposal"],
      [17, "reveal"],
      [999, "consent"], // unmapped screen falls back to consent
    ];
    for (const [screen, expectedStep] of cases) {
      const v1 = {
        savedAt: now - 1000,
        state: {
          screen,
          consentAt: null,
          consentMarketing: false,
          cityRaw: "",
          region: null,
          deckGender: null,
          displayName: "",
          dob: null,
          age: null,
          answers: { q5: null, q6: null, q7: null, q8: null, q9: null, q10: null, q11: [] },
          core: { primary: null, secondary: null, weight: null, ranked: [] },
          deckOrder: [],
          deckIndex: 0,
          deckHistory: [],
          dwell: {},
          liked: [],
          expanded: [],
          poolRemoved: [],
          redraws: 0,
          canRedraw: false,
          proposed: null,
          proposalsSeen: 0,
          proposalMode: null,
          locked: null,
          lockedAt: null,
          soundOn: true,
          unmuted: false,
          messages: [],
          exchanges: 0,
          accountDismissed: 0,
          accountAt: null,
          accountContact: null,
        },
      };
      const storage = fakeStorage({ [SESSION_KEY]: JSON.stringify(v1) });
      const out = migrate(storage, now);
      expect(out.flow, `screen ${screen}`).not.toBeNull();
      expect(out.flow!.kind).toBe("first");
      expect(out.flow!.step, `screen ${screen}`).toBe(expectedStep);
      expect(out.companions.length).toBe(0);
    }
  });

  it("23. migration is idempotent and never writes to ally_session", () => {
    const now = 1_700_000_000_000;
    const v1 = {
      savedAt: now - 1000,
      state: {
        screen: 5,
        consentAt: null,
        consentMarketing: false,
        cityRaw: "Pune",
        region: "West",
        deckGender: null,
        displayName: "A",
        dob: null,
        age: null,
        answers: { q5: null, q6: null, q7: null, q8: null, q9: null, q10: null, q11: [] },
        core: { primary: null, secondary: null, weight: null, ranked: [] },
        deckOrder: [],
        deckIndex: 0,
        deckHistory: [],
        dwell: {},
        liked: [],
        expanded: [],
        poolRemoved: [],
        redraws: 0,
        canRedraw: false,
        proposed: null,
        proposalsSeen: 0,
        proposalMode: null,
        locked: null,
        lockedAt: null,
        soundOn: true,
        unmuted: false,
        messages: [],
        exchanges: 0,
        accountDismissed: 0,
        accountAt: null,
        accountContact: null,
      },
    };
    const storage = fakeStorage({ [SESSION_KEY]: JSON.stringify(v1) });
    const first = migrate(storage, now);
    const second = migrate(storage, now);
    expect(second).toEqual(first);
    expect(storage.setCalls.includes(SESSION_KEY)).toBe(false);
    // STATE_KEY was written (first run persisted, second run just returned it)
    expect(storage.setCalls.filter((k) => k === STATE_KEY).length).toBeGreaterThanOrEqual(1);
  });

  // Test 26 itself (spec: clock.test.ts boot-logic group) lives in
  // clock.test.ts, since that's where the spec groups it; this is
  // supporting coverage for the same migrate() behaviour from the
  // migration side.
  it("supporting: an ally_v2 state with a 400-day-old savedAt is returned intact, unmodified — no age-based discard exists for v2", () => {
    const now = 1_700_000_000_000;
    const old = now - 400 * DAY;
    const v2 = {
      v: 2,
      savedAt: old,
      user: { displayName: "X", consentAt: old, consentMarketing: false, accountAt: null, accountContact: null, accountKind: null, accountDismissed: 0, soundOn: true, unmuted: false },
      companions: [
        {
          id: "c_old",
          templateId: "F03",
          deckGender: "woman",
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
    expect(out.companions[0].id).toBe("c_old");
    expect(out.companions[0].status).toBe("active");
    expect(out.savedAt).toBe(old); // returned as-is, migrate() does not touch it
  });

  it("v1 session's `savedAt` age is likewise never checked (no 30-day discard is implemented in migrate())", () => {
    // Spec §4.2's old table described a 30-day discard for stale v1
    // sessions. The current migrate() does not branch on v1.savedAt age at
    // all — a v1 session from 400 days ago still migrates normally. This is
    // a real behavioural gap vs. the old spec table; flagged in the report,
    // not papered over here.
    const now = 1_700_000_000_000;
    const veryOld = now - 400 * DAY;
    const v1 = {
      savedAt: veryOld,
      state: {
        screen: 4,
        consentAt: null,
        consentMarketing: false,
        cityRaw: "",
        region: null,
        deckGender: null,
        displayName: "Old",
        dob: null,
        age: null,
        answers: { q5: null, q6: null, q7: null, q8: null, q9: null, q10: null, q11: [] },
        core: { primary: null, secondary: null, weight: null, ranked: [] },
        deckOrder: [],
        deckIndex: 0,
        deckHistory: [],
        dwell: {},
        liked: [],
        expanded: [],
        poolRemoved: [],
        redraws: 0,
        canRedraw: false,
        proposed: null,
        proposalsSeen: 0,
        proposalMode: null,
        locked: null,
        lockedAt: null,
        soundOn: true,
        unmuted: false,
        messages: [],
        exchanges: 0,
        accountDismissed: 0,
        accountAt: null,
        accountContact: null,
      },
    };
    const storage = fakeStorage({ [SESSION_KEY]: JSON.stringify(v1) });
    const out = migrate(storage, now);
    // Not discarded: the old displayName survived migration despite being 400 days stale.
    expect(out.user.displayName).toBe("Old");
    expect(out.flow).not.toBeNull();
  });

  it("isBlocked: true while `until` is in the future, false once past", () => {
    const now = 1_700_000_000_000;
    const future = fakeStorage({ [BLOCK_KEY]: String(now + 1000) });
    const past = fakeStorage({ [BLOCK_KEY]: String(now - 1000) });
    const none = fakeStorage();
    expect(isBlocked(future, now)).toBe(true);
    expect(isBlocked(past, now)).toBe(false);
    expect(isBlocked(none, now)).toBe(false);
  });
});

describe("per-user keys and wipeLegacy (P1)", () => {
  const now = 1_700_000_000_000;

  it("stateKeyFor namespaces by uid", () => {
    expect(stateKeyFor("abc-123")).toBe("ally_v2:abc-123");
    expect(stateKeyFor("a")).not.toBe(stateKeyFor("b"));
  });

  it("migrate reads and writes the given key, leaving ally_v2 alone", () => {
    const storage = fakeStorage();
    const key = stateKeyFor("u1");
    const first = migrate(storage, now, key);
    expect(storage.dump()[key]).toBeDefined();
    expect(storage.dump()[STATE_KEY]).toBeUndefined();
    expect(first.flow?.step).toBe("consent");
    // second call returns the stored value byte for byte
    expect(migrate(storage, now, key)).toEqual(first);
  });

  it("two users on one device get separate state", () => {
    const storage = fakeStorage();
    const a = migrate(storage, now, stateKeyFor("a"));
    storage.setItem(stateKeyFor("a"), JSON.stringify({ ...a, user: { ...a.user, displayName: "Alice" } }));
    const b = migrate(storage, now, stateKeyFor("b"));
    expect(b.user.displayName).toBe("");
    expect(migrate(storage, now, stateKeyFor("a")).user.displayName).toBe("Alice");
  });

  it("a per-user key never inherits the device's v1 ally_session", () => {
    const v1 = { savedAt: now, state: { screen: 3, displayName: "Legacy", answers: {}, core: {}, locked: null } };
    const storage = fakeStorage({ [SESSION_KEY]: JSON.stringify(v1) });
    const out = migrate(storage, now, stateKeyFor("u1"));
    expect(out.user.displayName).toBe("");
    expect(out.flow?.step).toBe("consent");
    expect(storage.dump()[SESSION_KEY]).toBe(JSON.stringify(v1));
  });

  it("wipeLegacy deletes only the exact ally_v2 key", () => {
    const m = new Map<string, string>([
      [STATE_KEY, "legacy"],
      [stateKeyFor("u1"), "keep"],
      [BLOCK_KEY, "123"],
      [SESSION_KEY, "v1"],
      ["ally_v2x", "keep2"],
    ]);
    const removed: string[] = [];
    wipeLegacy({
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => {
        removed.push(k);
        m.delete(k);
      },
    });
    expect(removed).toEqual([STATE_KEY]);
    expect(m.has(STATE_KEY)).toBe(false);
    expect([...m.keys()].sort()).toEqual([BLOCK_KEY, SESSION_KEY, "ally_v2x", stateKeyFor("u1")].sort());
  });
});
