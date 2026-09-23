"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useAuth } from "@/state/useAuth";
import { useToast } from "@/state/useToast";
import { now } from "@/lib/clock";
import { COPY } from "@/lib/copy";
import { CONSENT_VERSION } from "@/lib/config";
import { getBrowserClient } from "@/lib/supabase/browser";
import { authErrorMessage } from "@/lib/authErrors";
import { TurnstileMount, useTurnstile } from "@/lib/turnstile";
import styles from "./page.module.css";

export default function ConsentPage() {
  const router = useRouter();
  const { state, dispatch, ownerId } = useAlly();
  const auth = useAuth();
  const showToast = useToast();
  const { getToken, container } = useTurnstile();
  const [busy, setBusy] = useState(false);
  // The uid to wait for before navigating: the push must happen only after
  // AllyProvider has adopted the in-memory flow under that uid (spec §5.4).
  const [goForUid, setGoForUid] = useState<string | null>(null);
  const [required, setRequired] = useState(!!state.user.consentAt);
  const [marketing, setMarketing] = useState(state.user.consentMarketing);

  useEffect(() => {
    if (state.flow?.kind === "round2") router.replace("/onboarding/gender");
  }, [state.flow, router]);

  useEffect(() => {
    if (goForUid && ownerId === goForUid) {
      dispatch({ type: "CONSENT", marketing, now: now() });
      router.push("/onboarding/location");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goForUid, ownerId]);

  if (!state.flow || state.flow.kind === "round2") return null;

  async function onContinue() {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = getBrowserClient();
      let uid = auth.user?.id ?? null;
      if (!uid) {
        const captchaToken = await getToken();
        const { data, error } = await supabase.auth.signInAnonymously({ options: { captchaToken } });
        if (error || !data.user) throw error ?? new TypeError("no user");
        uid = data.user.id;
      }
      const { error: consentError } = await supabase.from("consents").insert({ user_id: uid, version: CONSENT_VERSION, marketing });
      if (consentError) throw consentError;
      setGoForUid(uid);
    } catch (err) {
      showToast(authErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="stack">
        <h1>{COPY.consent.heading}</h1>
        <p>{COPY.consent.body}</p>
        <label className={styles.check}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <span>{COPY.consent.required}</span>
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
          <span>{COPY.consent.optional}</span>
        </label>
        <p>{COPY.consent.disclosure}</p>
      </div>
      <TurnstileMount container={container} />
      <div className="actions">
        <button type="button" className="btn primary" disabled={!required || busy} aria-busy={busy} onClick={() => void onContinue()}>
          {COPY.consent.action}
        </button>
      </div>
    </>
  );
}
