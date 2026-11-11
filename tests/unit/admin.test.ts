import { describe, it, expect } from "vitest";
import { auditLine, formatWhen, ledgerSummary, parseOverride, userLabel, type AdminLedger } from "@/lib/admin";

const LEDGER: AdminLedger = {
  plan: "trial",
  plan_forced: false,
  trial_ends_at: "2026-09-25T04:30:00Z",
  slot_limit: 1,
  free_used: 30,
  free_daily: 100,
  free_left: 70,
  fair_use_cap: 300,
};

describe("admin console helpers (P3)", () => {
  it("formatWhen shows IST regardless of the host timezone, and 'Never' for null", () => {
    // 18:30 UTC is midnight IST the next day.
    expect(formatWhen("2026-09-24T18:30:00.123456+00:00")).toMatch(/25 Sept? 2026, 00:00/);
    expect(formatWhen(null)).toBe("Never");
    expect(formatWhen("not a date")).toBe("Never");
  });

  it("userLabel prefers the email, then marks guests as Anonymous", () => {
    expect(userLabel({ email: "a@b.co", is_anonymous: false })).toBe("a@b.co");
    expect(userLabel({ email: null, is_anonymous: true })).toBe("Anonymous");
    expect(userLabel({ email: "", is_anonymous: true })).toBe("Anonymous");
  });

  it("ledgerSummary shows the trial with chats left today, no plan, or the paid tier", () => {
    expect(ledgerSummary(LEDGER)).toMatch(/^Trial until 25 Sept? 2026, 10:00, 70 of 100 chats left today$/);
    expect(ledgerSummary({ ...LEDGER, plan: "expired" })).toBe("No active plan");
    expect(ledgerSummary({ ...LEDGER, plan: "max" })).toBe("Max");
    expect(ledgerSummary({ ...LEDGER, plan: "ultra", plan_forced: true })).toBe("Ultra (forced)");
  });

  it("parseOverride: empty clears, whole numbers pass, anything else is refused", () => {
    expect(parseOverride("")).toEqual({ ok: true, value: null });
    expect(parseOverride("  ")).toEqual({ ok: true, value: null });
    expect(parseOverride("0")).toEqual({ ok: true, value: 0 });
    expect(parseOverride(" 250 ")).toEqual({ ok: true, value: 250 });
    for (const bad of ["-1", "1.5", "abc", "1e3", "99999999"]) expect(parseOverride(bad), bad).toEqual({ ok: false });
  });

  it("auditLine describes each action with its old and new values", () => {
    expect(auditLine({ action: "set_slots", old_value: { slots_unlocked: 1 }, new_value: { slots_unlocked: 3 } })).toBe("Changed slots: 1 → 3");
    expect(auditLine({ action: "set_free_daily_override", old_value: { free_daily_override: null }, new_value: { free_daily_override: 5 } })).toBe(
      "Changed trial daily chats: default → 5"
    );
    expect(auditLine({ action: "grant_pass", old_value: null, new_value: { hours: 24 } })).toBe("Granted a pass (24h)");
    expect(auditLine({ action: "force_logout", old_value: { sessions: 2 }, new_value: { sessions: 0 } })).toBe("Logged out everywhere (2 sessions)");
    expect(auditLine({ action: "suspend", old_value: { status: "active" }, new_value: { status: "suspended" } })).toBe("Suspended");
  });
});
