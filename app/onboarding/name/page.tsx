"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { COPY } from "@/lib/copy";
import styles from "./page.module.css";

export default function NamePage() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const [value, setValue] = useState(state.flow?.displayName ?? "");

  useEffect(() => {
    if (state.flow?.kind === "round2") router.replace("/onboarding/gender");
  }, [state.flow, router]);

  if (!state.flow || state.flow.kind === "round2") return null;

  const canContinue = value.trim().length > 0;

  function onContinue() {
    const v = value.trim().slice(0, 24);
    dispatch({ type: "SET_NAME", name: v });
    router.push("/onboarding/birthday");
  }

  return (
    <>
      <div className="stack">
        <h1 className="q">{COPY.name.question}</h1>
        <input
          className={styles.field}
          type="text"
          maxLength={24}
          autoComplete="given-name"
          autoCapitalize="words"
          spellCheck={false}
          aria-label={COPY.name.question}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canContinue) onContinue();
          }}
        />
      </div>
      <div className="actions">
        <button type="button" className="btn primary" disabled={!canContinue} onClick={onContinue}>
          {COPY.consent.action}
        </button>
      </div>
    </>
  );
}
