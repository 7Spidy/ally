"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useAuth } from "@/state/useAuth";
import { useSheet } from "@/state/useSheet";
import { useManifest } from "@/state/useManifest";
import { CodeInput } from "@/components/auth/CodeInput";
import { PasswordField } from "@/components/auth/PasswordField";
import { getBrowserClient } from "@/lib/supabase/browser";
import { authErrorMessage } from "@/lib/authErrors";
import { firstNameFromFull } from "@/lib/engine";
import { lastOpened } from "@/lib/selectors";
import { stateKeyFor } from "@/lib/migrate";
import { OTP_LENGTH, PASSWORD_MIN } from "@/lib/config";
import { COPY, fill } from "@/lib/copy";
import { TurnstileMount, useTurnstile } from "@/lib/turnstile";
import styles from "./page.module.css";

type Panel = null | "password" | "logoutAll" | "delete";

export default function AccountSettingsPage() {
  const router = useRouter();
  const { state } = useAlly();
  const auth = useAuth();
  const { openSheet } = useSheet();
  const { templates } = useManifest();
  const { getToken, container } = useTurnstile();

  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // password panel
  const [password, setPassword] = useState("");
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauthCode, setReauthCode] = useState("");

  // delete panel
  const [typed, setTyped] = useState("");
  const [deleteCodeSent, setDeleteCodeSent] = useState(false);
  const [deleteCode, setDeleteCode] = useState("");

  const anonymous = auth.isAnonymous;
  const email = auth.email;
  const passwordOk = password.length >= PASSWORD_MIN;

  function open(p: Panel) {
    setPanel(p);
    setMessage(null);
    setPassword("");
    setNeedsReauth(false);
    setReauthCode("");
    setTyped("");
    setDeleteCodeSent(false);
    setDeleteCode("");
  }

  function openSaveAccount() {
    const last = lastOpened(state);
    const template = last ? templates.find((t) => t.id === last.templateId) : undefined;
    openSheet("account", { personaName: template ? firstNameFromFull(template.name) : "your companion", exchanges: 1 });
  }

  async function savePassword(nonce?: string) {
    if (!passwordOk || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const supabase = getBrowserClient();
      const attrs = { password, data: { has_password: true }, ...(nonce ? { nonce } : {}) };
      const { error } = await supabase.auth.updateUser(attrs);
      if (error) {
        if (error.code === "reauthentication_needed") {
          const { error: reauthError } = await supabase.auth.reauthenticate();
          if (reauthError) {
            setMessage(authErrorMessage(reauthError));
            return;
          }
          setNeedsReauth(true);
          return;
        }
        setMessage(authErrorMessage(error, nonce ? "code" : "other"));
        setReauthCode("");
        return;
      }
      open(null);
    } catch (err) {
      setMessage(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function logOut(scope: "local" | "global") {
    if (busy) return;
    setBusy(true);
    try {
      await getBrowserClient().auth.signOut({ scope });
    } catch {
      /* the local session is cleared regardless */
    }
    router.replace("/");
  }

  async function startDelete() {
    if (!email || typed !== "DELETE" || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const captchaToken = await getToken();
      const { error } = await getBrowserClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false, captchaToken } });
      if (error) {
        setMessage(authErrorMessage(error));
        return;
      }
      setDeleteCodeSent(true);
    } catch (err) {
      setMessage(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(token: string) {
    if (!email || busy || token.length !== OTP_LENGTH) return;
    setBusy(true);
    setMessage(null);
    try {
      const supabase = getBrowserClient();
      const uid = auth.user?.id ?? null;
      const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
      if (error) {
        setDeleteCode("");
        setMessage(authErrorMessage(error, "code"));
        return;
      }
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) {
        setDeleteCode("");
        setMessage(COPY.auth.network);
        return;
      }
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        /* the user row is already gone */
      }
      try {
        if (uid) window.localStorage.removeItem(stateKeyFor(uid));
      } catch {
        /* storage blocked */
      }
      router.replace("/");
    } catch (err) {
      setDeleteCode("");
      setMessage(authErrorMessage(err, "code"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => router.push("/settings")}>
          <svg viewBox="0 0 24 24">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <h1 className={styles.title}>{COPY.settings.account}</h1>
      </div>

      <div className={styles.body}>
        <div className={styles.group}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{COPY.account.field}</span>
            <span className={styles.rowValue}>{anonymous ? COPY.settings.notSaved : email}</span>
          </div>
          {anonymous && (
            <button type="button" className={styles.row} onClick={openSaveAccount}>
              <span className={styles.rowLabel}>{COPY.settings.saveAccount}</span>
            </button>
          )}
        </div>

        {!anonymous && (
          <div className={styles.group}>
            <button type="button" className={styles.row} aria-expanded={panel === "password"} onClick={() => open(panel === "password" ? null : "password")}>
              <span className={styles.rowLabel}>{auth.hasPassword ? COPY.settings.changePassword : COPY.settings.setPassword}</span>
            </button>
            {panel === "password" && (
              <div className={`stack ${styles.panel}`}>
                <PasswordField value={password} onChange={setPassword} label={COPY.reset.newPassword} autoComplete="new-password" onEnter={() => void savePassword()} disabled={busy || needsReauth} />
                <p className={styles.note}>{COPY.reset.min}</p>
                {needsReauth ? (
                  <>
                    <p className={styles.note}>{fill(COPY.settings.deleteCode, { email: email ?? "" })}</p>
                    <CodeInput value={reauthCode} onChange={setReauthCode} onComplete={(v) => void savePassword(v)} disabled={busy} autoFocus />
                  </>
                ) : (
                  <button type="button" className="btn primary" disabled={!passwordOk || busy} onClick={() => void savePassword()}>
                    {COPY.account.passwordSave}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className={styles.group}>
          <button type="button" className={styles.row} disabled={busy} onClick={() => void logOut("local")}>
            <span className={styles.rowLabel}>{COPY.settings.logOut}</span>
          </button>
          <button type="button" className={styles.row} aria-expanded={panel === "logoutAll"} onClick={() => open(panel === "logoutAll" ? null : "logoutAll")}>
            <span className={styles.rowLabel}>{COPY.settings.logOutAll}</span>
          </button>
          {panel === "logoutAll" && (
            <div className={`stack ${styles.panel}`}>
              <p className={styles.note}>{COPY.settings.logOutAllConfirm}</p>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void logOut("global")}>
                {COPY.settings.logOutAll}
              </button>
              <button type="button" className="btn secondary" onClick={() => open(null)}>
                {COPY.confirm.secondary}
              </button>
            </div>
          )}
        </div>

        {!anonymous && (
          <div className={styles.group}>
            <button type="button" className={styles.row} aria-expanded={panel === "delete"} onClick={() => open(panel === "delete" ? null : "delete")}>
              <span className={styles.rowLabel}>{COPY.settings.delete}</span>
            </button>
            {panel === "delete" && (
              <div className={`stack ${styles.panel}`}>
                {!deleteCodeSent ? (
                  <>
                    <p className={styles.note}>{COPY.settings.deleteConfirm}</p>
                    <input
                      className={styles.field}
                      aria-label="DELETE"
                      placeholder="DELETE"
                      autoComplete="off"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                    />
                    <button type="button" className="btn primary" disabled={typed !== "DELETE" || busy} onClick={() => void startDelete()}>
                      {COPY.settings.delete}
                    </button>
                  </>
                ) : (
                  <>
                    <p className={styles.note}>{fill(COPY.settings.deleteCode, { email: email ?? "" })}</p>
                    <CodeInput value={deleteCode} onChange={setDeleteCode} onComplete={(v) => void confirmDelete(v)} disabled={busy} autoFocus />
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {message && (
          <p className={styles.note} role="alert">
            {message}
          </p>
        )}
      </div>
      <TurnstileMount container={container} />
    </div>
  );
}
