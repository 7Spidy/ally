import { describe, it, expect } from "vitest";
import { auditLine, formatWhen, ledgerSummary, parseOverride, userLabel, type AdminLedger } from "@/lib/admin";

const LEDGER: AdminLedger = {
  slots_unlocked: 1,
  free_used: 30,
  free_daily: 100,
  free_left: 70,
  pass_cap: 2000,
  pass_active: false,
  pass_started_at: null,
  pass_ends_at: null,
  pass_used: null,
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

  it("ledgerSummary shows free messages left, or the pass while one is active", () => {
    expect(ledgerSummary(LEDGER)).toBe("70 of 100 free left today");
    const onPass = { ...LEDGER, pass_active: true, pass_ends_at: "2026-09-25T04:30:00Z", pass_used: 12 };
    expect(ledgerSummary(onPass)).toMatch(/^Pass until 25 Sept? 2026, 10:00, 12 of 2000 used$/);
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
      "Changed free daily limit: default → 5"
    );
    expect(auditLine({ action: "grant_pass", old_value: null, new_value: { hours: 24 } })).toBe("Granted a pass (24h)");
    expect(auditLine({ action: "force_logout", old_value: { sessions: 2 }, new_value: { sessions: 0 } })).toBe("Logged out everywhere (2 sessions)");
    expect(auditLine({ action: "suspend", old_value: { status: "active" }, new_value: { status: "suspended" } })).toBe("Suspended");
  });
});
