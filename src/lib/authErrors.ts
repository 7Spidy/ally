/** Spec §5.13: maps Supabase auth error codes to COPY strings. Pure. */

import { COPY } from "@/lib/copy";

export interface AuthErrorLike {
  code?: string;
  status?: number;
  name?: string;
  message?: string;
}

export type AuthErrorContext = "code" | "other";

/** Codes the calling flow handles itself rather than showing a message. */
export const FLOW_HANDLED_CODES = ["email_exists", "reauthentication_needed"] as const;

export function isFlowHandled(err: AuthErrorLike | null | undefined): boolean {
  return !!err?.code && (FLOW_HANDLED_CODES as readonly string[]).includes(err.code);
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const e = err as AuthErrorLike | null;
  return !!e && (e.name === "AuthRetryableFetchError" || e.status === 0);
}

export function authErrorMessage(err: unknown, context: AuthErrorContext = "other"): string {
  if (isNetworkError(err)) return COPY.auth.network;
  const code = (err as AuthErrorLike | null)?.code;
  switch (code) {
    case "otp_expired":
      return COPY.auth.expiredCode;
    case "invalid_credentials":
      return COPY.login.badLogin;
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return COPY.auth.rateLimited;
    case "captcha_failed":
      return COPY.auth.captcha;
    case "weak_password":
      return COPY.reset.min;
    default:
      return context === "code" ? COPY.auth.wrongCode : COPY.auth.network;
  }
}
