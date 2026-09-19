"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { now } from "@/lib/clock";
import { COPY } from "@/lib/copy";
import styles from "./page.module.css";

export default function ConsentPage() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const [required, setRequired] = useState(!!state.user.consentAt);
  const [marketing, setMarketing] = useState(state.user.consentMarketing);

  useEffect(() => {
    if (state.flow?.kind === "round2") router.replace("/onboarding/gender");
  }, [state.flow, router]);

  if (!state.flow || state.flow.kind === "round2") return null;

  function onContinue() {
    dispatch({ type: "CONSENT", marketing, now: now() });
    router.push("/onboarding/location");
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
      <div className="actions">
        <button type="button" className="btn primary" disabled={!required} onClick={onContinue}>
          {COPY.consent.action}
        </button>
      </div>
    </>
  );
}
