"use client";

import { useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import { Sheet } from "@/components/Sheet";
import { CodeInput } from "@/components/auth/CodeInput";
import { PasswordField } from "@/components/auth/PasswordField";
import { ResendButton } from "@/components/auth/ResendButton";
import { getBrowserClient } from "@/lib/supabase/browser";
import { accountFlowReducer, initialAccountFlow, validEmail } from "@/lib/accountFlow";
import { authErrorMessage } from "@/lib/authErrors";
import { now } from "@/lib/clock";
import { OTP_LENGTH, PASSWORD_MIN } from "@/lib/config";
import { COPY, fill } from "@/lib/copy";
import styles from "./AccountSheet.module.css";

/**
 * Registered as 'account'. P1: attaches a verified email to the visitor's
 * anonymous Supabase user (same user id throughout). Steps, from
 * accountFlow.ts: email -> code -> optional password -> done, with a
 * `collision` branch when the email already belongs to another account.
 *
 * *When* to open this sheet (the 1st/3rd/7th exchange gating) is the chat
 * screen's job; this component just needs a simple props contract:
 *
 *   <AccountSheet personaName={string} exchanges={number} onSaved={() => void} blocking?={boolean} />
 *
 * `exchanges` drives the same nudge/return/block behaviour as the
 * reference build: dismissible until the 7th exchange, then the "Not now"
 * button disappears (a hard block). §8.2 step 1's round-two entry point
 * opens this with `exchanges: 7` (forcing non-dismissible) and an `onSaved`
 * callback that resumes round two once the account is created — see
 * IntroSheet.tsx.
 */
export function AccountSheet(props: Record<string, unknown>) {
  const personaName = typeof props.personaName === "string" ? props.personaName : "";
  const exchanges = typeof props.exchanges === "number" ? props.exchanges : 1;
  const blocking = props.blocking === true;
  const onSaved = typeof props.onSaved === "function" ? (props.onSaved as () => void) : null;

  const router = useRouter();
  const { dispatch } = useAlly();
  const { closeSheet, dismissForNavigation } = useSheet();
  const [flow, send] = useReducer(accountFlowReducer, undefined, initialAccountFlow);
  const [emailInput, setEmailInput] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendKey, setResendKey] = useState(0);

  const dismissible = !blocking && exchanges < 7;
  const emailOk = validEmail(emailInput);
  const passwordOk = password.length >= PASSWORD_MIN;

  async function sendCode(email: string, isResend: boolean) {
    setBusy(true);
    try {
      const { error } = await getBrowserClient().auth.updateUser({ email });
      if (error) {
        if (error.code === "email_exists") send({ type: "EMAIL_EXISTS", email });
        else send({ type: "FAILED", message: authErrorMessage(error) });
        return;
      }
      if (isResend) {
        send({ type: "RESENT", now: now() });
        setResendKey((k) => k + 1);
      } else {
        send({ type: "CODE_SENT", email, now: now() });
      }
    } catch (err) {
      send({ type: "FAILED", message: authErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  function onSendCode() {
    if (!emailOk || busy) return;
    void sendCode(emailInput.trim().toLowerCase(), false);
  }

  async function onVerify(token: string) {
    if (busy || token.length !== OTP_LENGTH) return;
    setBusy(true);
    try {
      const { error } = await getBrowserClient().auth.verifyOtp({ email: flow.email, token, type: "email_change" });
      if (error) {
        setCode("");
        send({ type: "FAILED", message: authErrorMessage(error, "code") });
        return;
      }
      dispatch({ type: "ACCOUNT_SAVE", contact: flow.email, kind: "email", now: now() });
      send({ type: "CODE_VERIFIED" });
    } catch (err) {
      setCode("");
      send({ type: "FAILED", message: authErrorMessage(err, "code") });
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    // dismissForNavigation(), not closeSheet(): when `onSaved` reopens
    // another sheet right after, closeSheet()'s async history.back() would
    // race it — see SheetProvider.tsx's dismissForNavigation doc comment.
    // Safe to always use here (rather than only when onSaved is set): it
    // just means an unused dummy history entry lingers on the plain
    // chat-nudge path, the same accepted tradeoff made elsewhere.
    dismissForNavigation();
    onSaved?.();
  }

  async function onSavePassword() {
    if (!passwordOk || busy) return;
    setBusy(true);
    try {
      const { error } = await getBrowserClient().auth.updateUser({ password, data: { has_password: true } });
      if (error) {
        send({ type: "FAILED", message: authErrorMessage(error) });
        return;
      }
      send({ type: "PASSWORD_SAVED" });
      finish();
    } catch (err) {
      send({ type: "FAILED", message: authErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  function onSkipPassword() {
    send({ type: "SKIP_PASSWORD" });
    finish();
  }

  function onCollisionLogin() {
    dismissForNavigation();
    router.replace(`/login?email=${encodeURIComponent(flow.email)}&discard=1`);
  }

  function onDismiss() {
    if (busy) return;
    dispatch({ type: "ACCOUNT_DISMISS" });
    closeSheet();
  }

  const showNotNow = dismissible && !busy && (flow.step === "email" || flow.step === "code" || flow.step === "collision" || flow.step === "error");

  return (
    <Sheet labelledBy="a-heading">
      <div className="stack">
        <h1 className="q" id="a-heading">
          {flow.step === "password" ? COPY.account.passwordHeading : fill(COPY.account.heading, { persona: personaName })}
        </h1>

        {flow.step === "email" && (
          <>
            <p className="sub" style={{ marginTop: -8 }}>
              {COPY.account.sub}
            </p>
            <div className="stack">
              <input
                className={styles.field}
                type="email"
                inputMode="email"
                autoComplete="email"
                aria-label={COPY.account.field}
                placeholder={COPY.account.field}
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSendCode();
                }}
              />
              <button type="button" className="btn primary" disabled={!emailOk || busy} onClick={onSendCode}>
                {COPY.account.send}
              </button>
            </div>
          </>
        )}

        {flow.step === "code" && (
          <>
            <p className="sub" style={{ marginTop: -8 }}>
              {fill(COPY.account.codeSub, { email: flow.email })}
            </p>
            <div className="stack">
              <CodeInput value={code} onChange={setCode} onComplete={(v) => void onVerify(v)} disabled={busy} autoFocus />
              <ResendButton restartKey={resendKey} onResend={() => sendCode(flow.email, true)} />
            </div>
          </>
        )}

        {flow.step === "password" && (
          <>
            <p className="sub" style={{ marginTop: -8 }}>
              {COPY.account.passwordSub}
            </p>
            <div className="stack">
              <PasswordField value={password} onChange={setPassword} label={COPY.login.password} autoComplete="new-password" onEnter={() => void onSavePassword()} disabled={busy} />
              <p className="meta">{COPY.reset.min}</p>
              <button type="button" className="btn primary" disabled={!passwordOk || busy} onClick={() => void onSavePassword()}>
                {COPY.account.passwordSave}
              </button>
              <button type="button" className="btn quiet" disabled={busy} onClick={onSkipPassword}>
                {COPY.account.skip}
              </button>
            </div>
          </>
        )}

        {flow.step === "collision" && (
          <div className="stack">
            <p className="sub" style={{ marginTop: -8 }}>
              {COPY.account.collision}
            </p>
            <button type="button" className="btn primary" onClick={onCollisionLogin}>
              {COPY.account.collisionLogin}
            </button>
            <button type="button" className="btn secondary" onClick={() => {
                setEmailInput("");
                send({ type: "USE_OTHER_EMAIL" });
              }}>
              {COPY.account.collisionOther}
            </button>
          </div>
        )}

        {flow.step === "error" && (
          <div className="stack">
            <p className="sub" role="alert" style={{ marginTop: -8 }}>
              {flow.message}
            </p>
            <button type="button" className="btn secondary" onClick={() => send({ type: "RECOVER" })}>
              {COPY.confirm.secondary}
            </button>
          </div>
        )}

        {showNotNow && (
          <button type="button" className="btn quiet" onClick={onDismiss}>
            {COPY.introSheet.notNow}
          </button>
        )}
      </div>
    </Sheet>
  );
}
