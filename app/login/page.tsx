"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useAuth } from "@/state/useAuth";
import { CodeInput } from "@/components/auth/CodeInput";
import { PasswordField } from "@/components/auth/PasswordField";
import { ResendButton } from "@/components/auth/ResendButton";
import { getBrowserClient } from "@/lib/supabase/browser";
import { validEmail } from "@/lib/accountFlow";
import { authErrorMessage, isNetworkError } from "@/lib/authErrors";
import { OTP_LENGTH } from "@/lib/config";
import { COPY, fill } from "@/lib/copy";
import { TurnstileMount, useTurnstile } from "@/lib/turnstile";
import styles from "./page.module.css";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginScreen />
    </Suspense>
  );
}

function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, ownerId } = useAlly();
  const auth = useAuth();
  const { getToken, container } = useTurnstile();

  const [email, setEmail] = useState(params.get("email") ?? "");
  const [mode, setMode] = useState<"code" | "password">("code");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [resendKey, setResendKey] = useState(0);
  // The uid we just signed in as. Boot must not run until AllyProvider has
  // switched its state over to that user, or it decides from a stale
  // signed-out snapshot and shows the first-run splash instead of home.
  const [goForUid, setGoForUid] = useState<string | null>(null);

  useEffect(() => {
    if (goForUid && ownerId === goForUid) router.replace("/");
  }, [goForUid, ownerId, router]);

  const emailOk = validEmail(email);
  const normalised = email.trim().toLowerCase();
  const linkFailed = params.get("error") === "link";

  // Logging in replaces an anonymous session, which discards what was set up on this device.
  const wouldLoseOnboarding =
    auth.isAnonymous && (state.companions.length > 0 || (!!state.flow && state.flow.step !== "consent"));
  const needsConfirm = wouldLoseOnboarding && !confirmed;

  async function sendCode() {
    if (!emailOk || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const captchaToken = await getToken();
      const { error } = await getBrowserClient().auth.signInWithOtp({
        email: normalised,
        options: { shouldCreateUser: false, captchaToken },
      });
      // Never reveal whether the email exists: only rate limits and network
      // failures are surfaced, everything else shows the same generic line.
      if (error && (isNetworkError(error) || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit")) {
        setMessage(authErrorMessage(error));
        return;
      }
      setCodeSent(true);
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
      const { data, error } = await getBrowserClient().auth.verifyOtp({ email: normalised, token, type: "email" });
      if (error || !data.user) {
        setCode("");
        setMessage(authErrorMessage(error, "code"));
        return;
      }
      setGoForUid(data.user.id);
    } catch (err) {
      setCode("");
      setMessage(authErrorMessage(err, "code"));
    } finally {
      setBusy(false);
    }
  }

  async function passwordLogin() {
    if (!emailOk || !password || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const captchaToken = await getToken();
      const { data, error } = await getBrowserClient().auth.signInWithPassword({ email: normalised, password, options: { captchaToken } });
      if (error || !data.user) {
        setMessage(isNetworkError(error) ? COPY.auth.network : COPY.login.badLogin);
        return;
      }
      setGoForUid(data.user.id);
    } catch (err) {
      setMessage(isNetworkError(err) ? COPY.auth.network : COPY.login.badLogin);
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: "code" | "password") {
    setMode(next);
    setCodeSent(false);
    setCode("");
    setMessage(null);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => router.push("/")}>
          <svg viewBox="0 0 24 24">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <h1 className={styles.title}>{COPY.login.title}</h1>
      </div>

      <div className={styles.body}>
        {linkFailed && <p className={styles.note}>{COPY.login.linkFailed}</p>}

        {needsConfirm ? (
          <div className="stack">
            <p className="sub">{COPY.auth.loseOnboarding}</p>
            <button type="button" className="btn primary" onClick={() => setConfirmed(true)}>
              {COPY.login.submit}
            </button>
            <button type="button" className="btn secondary" onClick={() => router.push("/home")}>
              {COPY.confirm.secondary}
            </button>
          </div>
        ) : (
          <div className="stack">
            <input
              className={styles.field}
              type="email"
              inputMode="email"
              autoComplete="email"
              aria-label={COPY.account.field}
              placeholder={COPY.account.field}
              value={email}
              disabled={codeSent}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (mode === "code" && !codeSent) void sendCode();
                if (mode === "password") void passwordLogin();
              }}
            />

            {mode === "code" && !codeSent && (
              <button type="button" className="btn primary" disabled={!emailOk || busy} onClick={() => void sendCode()}>
                {COPY.login.sendCode}
              </button>
            )}

            {mode === "code" && codeSent && (
              <>
                <p className="sub">{fill(COPY.login.sent, { email: normalised })}</p>
                <CodeInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} autoFocus />
                <ResendButton restartKey={resendKey} onResend={sendCode} />
              </>
            )}

            {mode === "password" && (
              <>
                <PasswordField value={password} onChange={setPassword} label={COPY.login.password} onEnter={() => void passwordLogin()} disabled={busy} />
                <button type="button" className="btn primary" disabled={!emailOk || !password || busy} onClick={() => void passwordLogin()}>
                  {COPY.login.submit}
                </button>
              </>
            )}

            {message && (
              <p className={styles.note} role="alert">
                {message}
              </p>
            )}

            <button type="button" className="btn quiet" onClick={() => switchMode(mode === "code" ? "password" : "code")}>
              {mode === "code" ? COPY.login.usePassword : COPY.login.useCode}
            </button>
            <button type="button" className="btn quiet" onClick={() => router.push(`/login/reset?email=${encodeURIComponent(email)}`)}>
              {COPY.login.forgot}
            </button>
          </div>
        )}
      </div>
      <TurnstileMount container={container} />
    </div>
  );
}
