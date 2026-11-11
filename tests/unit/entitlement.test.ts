import { describe, it, expect } from "vitest";
import { activeCount, composerGate, gateForCode, hasFreeSlot, isPaid, isSendCode, lockedCompanionIds, parseEntitlement, trialDaysLeft } from "@/lib/entitlement";
import { freshEntitlement, type Companion, type Entitlement } from "@/state/schema";

function ent(over: Partial<Entitlement> = {}): Entitlement {
  return { ...freshEntitlement(), ...over };
}

function comp(id: string, createdAt: number, status: Companion["status"] = "active"): Companion {
  return { id, createdAt, status } as Companion;
}

describe("parseEntitlement", () => {
  it("maps the server's snake_case object", () => {
    expect(
      parseEntitlement({ plan: "trial", trial_ends_at: 99, trial_day: 3, slot_limit: 1, max_level: 5, can_send: true, chats_left_today: 80, cap_reached: false })
    ).toEqual({ plan: "trial", trialEndsAt: 99, trialDay: 3, slotLimit: 1, maxLevel: 5, canSend: true, chatsLeftToday: 80, capReached: false });
  });

  it("keeps the paid counter null so no cap can ever show", () => {
    const e = parseEntitlement({ plan: "pro", trial_ends_at: null, trial_day: null, slot_limit: 1, max_level: 5, can_send: true, chats_left_today: null, cap_reached: false });
    expect(e.chatsLeftToday).toBeNull();
    expect(e.trialEndsAt).toBeNull();
  });
});

describe("lockedCompanionIds (mirrors ally_private.companion_locked)", () => {
  const list = [comp("c_d", 4), comp("c_a", 1), comp("c_c", 3), comp("c_b", 2)];

  it("keeps the first N active by creation and locks the rest", () => {
    expect([...lockedCompanionIds(list, 4)]).toEqual([]);
    expect([...lockedCompanionIds(list, 2)].sort()).toEqual(["c_c", "c_d"]);
    expect([...lockedCompanionIds(list, 1)].sort()).toEqual(["c_b", "c_c", "c_d"]);
  });

  it("locks everyone when there are no slots (expired)", () => {
    expect([...lockedCompanionIds(list, 0)].sort()).toEqual(["c_a", "c_b", "c_c", "c_d"]);
  });

  it("parted companions neither count nor get locked", () => {
    const withParted = [comp("c_a", 1, "parted"), comp("c_b", 2), comp("c_c", 3)];
    expect([...lockedCompanionIds(withParted, 1)]).toEqual(["c_c"]);
    expect(activeCount(withParted)).toBe(2);
  });

  it("breaks a tie on createdAt by id, and does not reorder the caller's array", () => {
    const tied = [comp("c_z", 5), comp("c_y", 5)];
    expect([...lockedCompanionIds(tied, 1)]).toEqual(["c_z"]);
    expect(tied.map((c) => c.id)).toEqual(["c_z", "c_y"]);
  });
});

describe("composerGate", () => {
  it("normal while chats remain", () => {
    expect(composerGate(ent({ chatsLeftToday: 50 }), false)).toBe("normal");
    expect(composerGate(ent({ plan: "pro", chatsLeftToday: null }), false)).toBe("normal");
  });

  it("oneLeft on the trial's last chat only", () => {
    expect(composerGate(ent({ chatsLeftToday: 1 }), false)).toBe("oneLeft");
    expect(composerGate(ent({ plan: "pro", chatsLeftToday: null }), false)).toBe("normal");
  });

  it("trialLimit when the trial's chats are used up, fairUse when a paid cap is", () => {
    expect(composerGate(ent({ canSend: false, capReached: true, chatsLeftToday: 0 }), false)).toBe("trialLimit");
    expect(composerGate(ent({ plan: "max", canSend: false, capReached: true, chatsLeftToday: null }), false)).toBe("fairUse");
  });

  it("expired beats everything; locked beats the cap", () => {
    expect(composerGate(ent({ plan: "expired", canSend: false }), true)).toBe("expired");
    expect(composerGate(ent({ plan: "pro", canSend: false }), true)).toBe("locked");
    expect(composerGate(ent({ plan: "pro" }), true)).toBe("locked");
  });
});

describe("send codes", () => {
  it("recognises exactly the four server codes", () => {
    for (const c of ["TRIAL_LIMIT", "PLAN_EXPIRED", "FAIR_USE_CAP", "COMPANION_LOCKED"]) expect(isSendCode(c)).toBe(true);
    for (const c of ["ok", "empty", "capped", "", null, undefined]) expect(isSendCode(c)).toBe(false);
  });

  it("each code maps to the composer state the same condition produces", () => {
    expect(gateForCode("TRIAL_LIMIT")).toBe("trialLimit");
    expect(gateForCode("PLAN_EXPIRED")).toBe("expired");
    expect(gateForCode("FAIR_USE_CAP")).toBe("fairUse");
    expect(gateForCode("COMPANION_LOCKED")).toBe("locked");
  });
});

describe("trial and plan helpers", () => {
  it("trialDaysLeft is the days after today: day 4 of 7 leaves 3, the last day 0", () => {
    expect(trialDaysLeft(ent({ trialDay: 1 }))).toBe(6);
    expect(trialDaysLeft(ent({ trialDay: 4 }))).toBe(3);
    expect(trialDaysLeft(ent({ trialDay: 7 }))).toBe(0);
    expect(trialDaysLeft(ent({ plan: "pro", trialDay: null }))).toBe(0);
  });

  it("isPaid and hasFreeSlot", () => {
    expect(isPaid("pro") && isPaid("max") && isPaid("ultra")).toBe(true);
    expect(isPaid("trial") || isPaid("expired")).toBe(false);
    expect(hasFreeSlot(ent({ slotLimit: 2 }), 1)).toBe(true);
    expect(hasFreeSlot(ent({ slotLimit: 2 }), 2)).toBe(false);
    expect(hasFreeSlot(ent({ plan: "expired", slotLimit: 0 }), 0)).toBe(false);
  });
});
