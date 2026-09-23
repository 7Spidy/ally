/**
 * Spec §5.6: the account sheet's step machine, pure and unit tested.
 * email -> code -> password -> done, plus `collision` and `error`. The
 * component performs the network calls and feeds their outcomes in as
 * events; this reducer only decides where the sheet goes next.
 */

import { OTP_RESEND_SECONDS } from "@/lib/config";

export type AccountStep = "email" | "code" | "password" | "done" | "collision" | "error";

export interface AccountFlowState {
  step: AccountStep;
  email: string;
  /** Epoch ms at which "Resend code" becomes available; null before a code is sent. */
  resendAt: number | null;
  /** Set only on the `error` step: the step to return to, and what to show. */
  errorFrom: Exclude<AccountStep, "error"> | null;
  message: string | null;
}

export type AccountFlowEvent =
  | { type: "CODE_SENT"; email: string; now: number }
  | { type: "RESENT"; now: number }
  | { type: "EMAIL_EXISTS"; email: string }
  | { type: "CODE_VERIFIED" }
  | { type: "PASSWORD_SAVED" }
  | { type: "SKIP_PASSWORD" }
  | { type: "FAILED"; message: string }
  | { type: "RECOVER" }
  | { type: "USE_OTHER_EMAIL" }
  | { type: "REOPEN" };

export function initialAccountFlow(): AccountFlowState {
  return { step: "email", email: "", resendAt: null, errorFrom: null, message: null };
}

export function accountFlowReducer(s: AccountFlowState, e: AccountFlowEvent): AccountFlowState {
  switch (e.type) {
    case "CODE_SENT":
      if (s.step !== "email") return s;
      return { step: "code", email: e.email, resendAt: e.now + OTP_RESEND_SECONDS * 1000, errorFrom: null, message: null };
    case "RESENT":
      if (s.step !== "code") return s;
      return { ...s, resendAt: e.now + OTP_RESEND_SECONDS * 1000 };
    case "EMAIL_EXISTS":
      if (s.step !== "email" && s.step !== "code") return s;
      return { step: "collision", email: e.email, resendAt: null, errorFrom: null, message: null };
    case "CODE_VERIFIED":
      if (s.step !== "code") return s;
      return { ...s, step: "password", errorFrom: null, message: null };
    case "PASSWORD_SAVED":
    case "SKIP_PASSWORD":
      if (s.step !== "password") return s;
      return { ...s, step: "done", errorFrom: null, message: null };
    case "FAILED":
      if (s.step === "error" || s.step === "done") return s;
      return { ...s, step: "error", errorFrom: s.step, message: e.message };
    case "RECOVER":
      if (s.step !== "error" || !s.errorFrom) return s;
      return { ...s, step: s.errorFrom, errorFrom: null, message: null };
    case "USE_OTHER_EMAIL":
      if (s.step !== "collision") return s;
      return initialAccountFlow();
    case "REOPEN":
      return initialAccountFlow();
    default:
      return s;
  }
}

export function canResend(s: AccountFlowState, now: number): boolean {
  return s.step === "code" && s.resendAt !== null && now >= s.resendAt;
}

export function resendSecondsLeft(s: AccountFlowState, now: number): number {
  if (s.resendAt === null) return 0;
  return Math.max(0, Math.ceil((s.resendAt - now) / 1000));
}

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function validEmail(v: string): boolean {
  return VALID_EMAIL.test(v.trim());
}
