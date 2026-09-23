"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/state/useAuth";
import { useToast } from "@/state/useToast";
import { CodeInput } from "@/components/auth/CodeInput";
import { PasswordField } from "@/components/auth/PasswordField";
import { ResendButton } from "@/components/auth/ResendButton";
import { getBrowserClient } from "@/lib/supabase/browser";
import { validEmail } from "@/lib/accountFlow";
import { authErrorMessage, isNetworkError } from "@/lib/authErrors";
import { OTP_LENGTH, PASSWORD_MIN } from "@/lib/config";
import { COPY, fill } from "@/lib/copy";
import { TurnstileMount, useTurnstile } from "@/lib/turnstile";
import styles from "./page.module.css";

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetScreen />
    </Suspense>
  );
}

type Step = "email" | "code" | "new";

function ResetScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const auth = useAuth();
  const showToast = useToast();
  const { getToken, container } = useTurnstile();

  const wantsNew = params.get("step") === "new";
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [resendKey, setResendKey] = useState(0);

  const normalised = email.trim().toLowerCase();
  const emailOk = validEmail(email);
  const passwordOk = password.length >= PASSWORD_MIN;
  const hasRealSession = !!auth.user && !auth.isAnonymous;

  // `?step=new` (the recovery link path) is only valid with a session; without one, start over at step 1.
  useEffect(() => {
    if (!auth.ready || !wantsNew) return;
    if (hasRealSession) setStep("new");
    else router.replace("/login/reset");
  }, [auth.ready, wantsNew, hasRealSession, router]);

  async function sendCode() {
    if (!emailOk || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const captchaToken = await getToken();
      const { error } = await getBrowserClient().auth.resetPasswordForEmail(normalised, {
        captchaToken,
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/confirm?type=recovery&next=/login/reset?step=new`,
      });
      // Never reveal whether the email exists.
      if (error && (isNetworkError(error) || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit")) {
        setMessage(authErrorMessage(error));
        return;
      }
      setStep("code");
      setCode("");
      setResendKey((k) => k + 1);
    } catch (err) {
      setMessage(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(token: string) {
    if (busy || token.length !== OTP_LENGTH) return;
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await getBrowserClient().auth.verifyOtp({ email: normalised, token, type: "recovery" });
      if (error) {
        setCode("");
        setMessage(authErrorMessage(error, "code"));
        return;
      }
      setStep("new");
    } catch (err) {
      setCode("");
      setMessage(authErrorMessage(err, "code"));
    } finally {
      setBusy(false);
    }
  }

  async function updatePassword() {
    if (!passwordOk || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const supabase = getBrowserClient();
      const { error } = await supabase.auth.updateUser({ password, data: { has_password: true } });
      if (error) {
        setMessage(authErrorMessage(error));
        return;
      }
      // Revoke every other device's session; this one stays signed in.
      await supabase.auth.signOut({ scope: "others" });
      showToast(COPY.reset.done);
      router.replace("/");
    } catch (err) {
      setMessage(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => router.push("/login")}>
          <svg viewBox="0 0 24 24">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <h1 className={styles.title}>{COPY.reset.title}</h1>
      </div>

      <div className={styles.body}>
        <div className="stack">
          {step === "email" && (
            <>
              <input
                className={styles.field}
                type="email"
                inputMode="email"
                autoComplete="email"
                aria-label={COPY.account.field}
                placeholder={COPY.account.field}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void sendCode();
                }}
              />
              <button type="button" className="btn primary" disabled={!emailOk || busy} onClick={() => void sendCode()}>
                {COPY.login.sendCode}
              </button>
            </>
          )}

          {step === "code" && (
            <>
              <p className="sub">{fill(COPY.reset.sent, { email: normalised })}</p>
              <CodeInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} autoFocus />
              <ResendButton restartKey={resendKey} onResend={sendCode} />
            </>
          )}

          {step === "new" && (
            <>
              <PasswordField value={password} onChange={setPassword} label={COPY.reset.newPassword} autoComplete="new-password" onEnter={() => void updatePassword()} disabled={busy} />
              <p className={styles.note}>{COPY.reset.min}</p>
              <button type="button" className="btn primary" disabled={!passwordOk || busy} onClick={() => void updatePassword()}>
                {COPY.reset.submit}
              </button>
            </>
          )}

          {message && (
            <p className={styles.note} role="alert">
              {message}
            </p>
          )}
        </div>
      </div>
      <TurnstileMount container={container} />
    </div>
  );
}
