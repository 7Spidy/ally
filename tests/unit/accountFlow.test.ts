import { describe, it, expect } from "vitest";
import { accountFlowReducer, canResend, initialAccountFlow, resendSecondsLeft, validEmail, type AccountFlowEvent, type AccountFlowState } from "@/lib/accountFlow";
import { OTP_RESEND_SECONDS } from "@/lib/config";

const T0 = 1_000_000;

function run(events: AccountFlowEvent[], from: AccountFlowState = initialAccountFlow()): AccountFlowState {
  return events.reduce(accountFlowReducer, from);
}

describe("accountFlow", () => {
  it("starts at the email step", () => {
    expect(initialAccountFlow().step).toBe("email");
  });

  it("happy path: email -> code -> password -> done", () => {
    let s = run([{ type: "CODE_SENT", email: "a@b.co", now: T0 }]);
    expect(s.step).toBe("code");
    expect(s.email).toBe("a@b.co");
    s = run([{ type: "CODE_VERIFIED" }], s);
    expect(s.step).toBe("password");
    s = run([{ type: "PASSWORD_SAVED" }], s);
    expect(s.step).toBe("done");
  });

  it("the password step can be skipped", () => {
    const s = run([{ type: "CODE_SENT", email: "a@b.co", now: T0 }, { type: "CODE_VERIFIED" }, { type: "SKIP_PASSWORD" }]);
    expect(s.step).toBe("done");
  });

  it("email_exists at the email step goes to collision, and 'Use another email' goes back to a blank email step", () => {
    let s = run([{ type: "EMAIL_EXISTS", email: "taken@b.co" }]);
    expect(s.step).toBe("collision");
    expect(s.email).toBe("taken@b.co");
    s = run([{ type: "USE_OTHER_EMAIL" }], s);
    expect(s.step).toBe("email");
    expect(s.email).toBe("");
  });

  it("email_exists is also handled if it surfaces from the code step (resend)", () => {
    const s = run([{ type: "CODE_SENT", email: "a@b.co", now: T0 }, { type: "EMAIL_EXISTS", email: "a@b.co" }]);
    expect(s.step).toBe("collision");
  });

  it("errors return to the step they came from", () => {
    for (const from of ["email", "code", "password"] as const) {
      const start: AccountFlowState = { ...initialAccountFlow(), step: from, email: "a@b.co" };
      const errored = run([{ type: "FAILED", message: "nope" }], start);
      expect(errored.step).toBe("error");
      expect(errored.message).toBe("nope");
      expect(errored.errorFrom).toBe(from);
      const recovered = run([{ type: "RECOVER" }], errored);
      expect(recovered.step).toBe(from);
      expect(recovered.message).toBeNull();
      expect(recovered.email).toBe("a@b.co");
    }
  });

  it("resend re-arms the countdown without leaving the code step", () => {
    let s = run([{ type: "CODE_SENT", email: "a@b.co", now: T0 }]);
    expect(canResend(s, T0)).toBe(false);
    expect(canResend(s, T0 + OTP_RESEND_SECONDS * 1000 - 1)).toBe(false);
    expect(canResend(s, T0 + OTP_RESEND_SECONDS * 1000)).toBe(true);
    s = run([{ type: "RESENT", now: T0 + 70_000 }], s);
    expect(s.step).toBe("code");
    expect(canResend(s, T0 + 70_000)).toBe(false);
    expect(resendSecondsLeft(s, T0 + 70_000)).toBe(OTP_RESEND_SECONDS);
    expect(resendSecondsLeft(s, T0 + 70_000 + 59_500)).toBe(1);
    expect(resendSecondsLeft(s, T0 + 70_000 + 90_000)).toBe(0);
  });

  it("events that don't apply to the current step are ignored", () => {
    const start = initialAccountFlow();
    expect(run([{ type: "CODE_VERIFIED" }], start)).toEqual(start);
    expect(run([{ type: "PASSWORD_SAVED" }], start)).toEqual(start);
    expect(run([{ type: "RESENT", now: T0 }], start)).toEqual(start);
    expect(run([{ type: "RECOVER" }], start)).toEqual(start);
    const done = run([{ type: "CODE_SENT", email: "a@b.co", now: T0 }, { type: "CODE_VERIFIED" }, { type: "SKIP_PASSWORD" }]);
    expect(run([{ type: "FAILED", message: "late" }], done)).toEqual(done);
  });

  it("REOPEN starts over at email", () => {
    const s = run([{ type: "CODE_SENT", email: "a@b.co", now: T0 }, { type: "REOPEN" }]);
    expect(s).toEqual(initialAccountFlow());
  });

  it("validEmail is format-only and trims", () => {
    expect(validEmail("a@b.co")).toBe(true);
    expect(validEmail("  a@b.co ")).toBe(true);
    expect(validEmail("a@b")).toBe(false);
    expect(validEmail("a b@c.co")).toBe(false);
    expect(validEmail("+919876543210")).toBe(false);
    expect(validEmail("")).toBe(false);
  });
});
