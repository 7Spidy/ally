import { describe, it, expect } from "vitest";
import { bootTarget } from "@/lib/boot";
import { migrate, stateKeyFor, type StorageLike } from "@/lib/migrate";
import type { AllyState, Companion } from "@/state/schema";

const DAY = 86400000;
const NOW = 1_700_000_000_000;

function emptyStorage(): StorageLike {
  return { getItem: () => null, setItem: () => {} };
}

function freshState(): AllyState {
  return migrate(emptyStorage(), NOW, stateKeyFor("u1"));
}

function companion(overrides: Partial<Companion> = {}): Companion {
  return {
    id: "c_a",
    templateId: "F01",
    deckGender: "woman",
    answers: { q5: null, q6: null, q7: null, q8: null, q9: null, q10: null, q11: [] },
    core: { primary: null, secondary: null, weight: null, ranked: [] },
    createdAt: NOW,
    lastOpenedAt: NOW,
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

describe("bootTarget with auth (P1)", () => {
  it("with no session, boot is a fresh first run at consent, ignoring stale in-memory companions", () => {
    const state = freshState();
    state.flow = null;
    state.companions = [companion()];
    state.user.accountAt = NOW;
    expect(bootTarget(state, false, false, NOW)).toEqual({ phase: "first-splash", step: "consent" });
  });

  it("with no session, a stale mid-flow step is not resumed either", () => {
    const state = freshState();
    state.flow = { ...state.flow!, step: "questions/warmth" };
    expect(bootTarget(state, false, false, NOW + 8 * DAY)).toEqual({ phase: "first-splash", step: "consent" });
  });

  it("blocked wins over everything, authed or not", () => {
    const state = freshState();
    state.flow = null;
    state.companions = [companion()];
    expect(bootTarget(state, true, false, NOW)).toEqual({ phase: "blocked" });
    expect(bootTarget(state, true, true, NOW)).toEqual({ phase: "blocked" });
  });

  it("with a session, the existing table is unchanged", () => {
    const state = freshState();
    state.flow = null;
    state.companions = [companion({ id: "c_a", lastOpenedAt: 1 }), companion({ id: "c_b", lastOpenedAt: 2 })];
    expect(bootTarget(state, false, true, NOW)).toEqual({ phase: "returning-splash", target: "/chat/c_b" });

    state.companions = [companion({ status: "parted", partedAt: 1, purgeAt: NOW + DAY })];
    expect(bootTarget(state, false, true, NOW)).toEqual({ phase: "returning-splash", target: "/home" });

    const first = freshState();
    first.flow = { ...first.flow!, step: "gender" };
    expect(bootTarget(first, false, true, NOW)).toEqual({ phase: "first-splash", step: "gender" });
  });
});
