"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useAuth } from "@/state/useAuth";
import { useManifest } from "@/state/useManifest";
import { useToast } from "@/state/useToast";
import { CodeInput } from "@/components/auth/CodeInput";
import { PasswordField } from "@/components/auth/PasswordField";
import { ResendButton } from "@/components/auth/ResendButton";
import { getBrowserClient } from "@/lib/supabase/browser";
import { validEmail } from "@/lib/accountFlow";
import { authErrorMessage, isNetworkError } from "@/lib/authErrors";
import { OTP_LENGTH } from "@/lib/config";
import { stateKeyFor } from "@/lib/migrate";
import { active, lastOpened } from "@/lib/selectors";
import { firstNameFromFull } from "@/lib/engine";
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

const MERGE_KEY = "ally_merge_anon";
const MERGE_TRIES = 3;

interface MergeResult {
  moved: string[];
  skipped: { id: string; reason: "duplicate" | "full" }[];
}

function readStoredMerge(): { uid: string; token: string } | null {
  try {
    const raw = window.sessionStorage.getItem(MERGE_KEY);
    return raw ? (JSON.parse(raw) as { uid: string; token: string }) : null;
  } catch {
    return null;
  }
}

function clearStoredMerge() {
  try {
    window.sessionStorage.removeItem(MERGE_KEY);
  } catch {
    /* storage blocked */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, ownerId, reloadServerState } = useAlly();
  const auth = useAuth();
  const { templates } = useManifest();
  const showToast = useToast();
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;
  // The anonymous session's token, kept for the merge after sign-in. Also in
  // sessionStorage so a reload between sending the code and verifying keeps it.
  const anonRef = useRef<{ uid: string; token: string } | null>(null);
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

  // An anonymous user with a companion brings it along; one with only an unfinished setup loses it.
  const carried = auth.isAnonymous ? lastOpened(state) : undefined;
  const carriedTemplate = carried ? templates.find((t) => t.id === carried.templateId) : undefined;
  const hasCompanion = auth.isAnonymous && active(state).length > 0;
  const wouldLoseOnboarding = auth.isAnonymous && !hasCompanion && !!state.flow && state.flow.step !== "consent";
  const needsConfirm = wouldLoseOnboarding && !confirmed;

  /** Remembers the anonymous session's token before it is replaced by signing in. */
  async function captureAnon() {
    if (!auth.isAnonymous || state.companions.length === 0) return;
    try {
      const { data } = await getBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      const uid = data.session?.user.id;
      if (!token || !uid) return;
      anonRef.current = { uid, token };
      try {
        window.sessionStorage.setItem(MERGE_KEY, JSON.stringify(anonRef.current));
      } catch {
        /* storage blocked */
      }
    } catch {
      /* no token: login proceeds without a carry */
    }
  }

  async function postMerge(targetToken: string, anonAccessToken: string): Promise<MergeResult | null> {
    for (let attempt = 0; attempt < MERGE_TRIES; attempt++) {
      try {
        const res = await fetch("/api/account/merge", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${targetToken}` },
          body: JSON.stringify({ anonAccessToken }),
        });
        if (res.ok) return (await res.json()) as MergeResult;
        if (res.status < 500) return null; // a refusal will not change on retry
      } catch {
        /* network error: retry */
      }
      if (attempt < MERGE_TRIES - 1) await sleep(1000);
    }
    return null;
  }

  /** After a successful sign-in: merge the anonymous session's companions, then head for the right screen. */
  async function afterSignIn(uid: string, accessToken: string | undefined) {
    const anon = anonRef.current ?? readStoredMerge();
    if (!anon || !accessToken || anon.uid === uid) {
      setGoForUid(uid);
      return;
    }
    const result = await postMerge(accessToken, anon.token);
    clearStoredMerge();
    anonRef.current = null;
    if (!result) {
      showToast(COPY.login.carryFailed);
      setGoForUid(uid);
      return;
    }
    try {
      window.localStorage.removeItem(stateKeyFor(anon.uid));
    } catch {
      /* storage blocked */
    }
    // Let the provider's own load for the new user land first, or it could overwrite the reload.
    for (let i = 0; i < 100 && ownerRef.current !== uid; i++) await sleep(50);
    try {
      await reloadServerState();
    } catch {
      showToast(COPY.login.carryFailed);
      setGoForUid(uid);
      return;
    }
    if (result.skipped.length > 0) showToast(COPY.login.carryPartial);
    if (result.moved.length > 0) router.replace(`/chat/${result.moved[0]}`);
    else setGoForUid(uid);
  }

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
      await captureAnon();
      const { data, error } = await getBrowserClient().auth.verifyOtp({ email: normalised, token, type: "email" });
      if (error || !data.user) {
        setCode("");
        setMessage(authErrorMessage(error, "code"));
        return;
      }
      await afterSignIn(data.user.id, data.session?.access_token);
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
      await captureAnon();
      const { data, error } = await getBrowserClient().auth.signInWithPassword({ email: normalised, password, options: { captchaToken } });
      if (error || !data.user) {
        setMessage(isNetworkError(error) ? COPY.auth.network : COPY.login.badLogin);
        return;
      }
      await afterSignIn(data.user.id, data.session?.access_token);
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
        {hasCompanion && carriedTemplate && (
          <p className="sub">{fill(COPY.login.carry, { persona: firstNameFromFull(carriedTemplate.name) })}</p>
        )}

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
