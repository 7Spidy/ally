"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { COPY } from "@/lib/copy";
import { NAME_MAX, checkName } from "@/lib/nameCheck";
import styles from "./page.module.css";

export default function NamePage() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const [value, setValue] = useState(state.flow?.displayName ?? "");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (state.flow?.kind === "round2") router.replace("/onboarding/gender");
  }, [state.flow, router]);

  if (!state.flow || state.flow.kind === "round2") return null;

  const result = checkName(value);
  const canContinue = result.ok;
  const error = touched && !result.ok ? COPY.name.errors[result.problem] : null;

  function onContinue() {
    setTouched(true);
    if (!result.ok) return;
    dispatch({ type: "SET_NAME", name: result.value });
    router.push("/onboarding/birthday");
  }

  return (
    <>
      <div className="stack">
        <h1 className="q">{COPY.name.question}</h1>
        <input
          className={styles.field}
          type="text"
          maxLength={NAME_MAX}
          autoComplete="given-name"
          autoCapitalize="words"
          spellCheck={false}
          aria-label={COPY.name.question}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "name-error" : undefined}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canContinue) onContinue();
          }}
        />
        {error && (
          <p id="name-error" role="alert" className="sub">
            {error}
          </p>
        )}
      </div>
      <div className="actions">
        <button type="button" className="btn primary" disabled={!canContinue} onClick={onContinue}>
          {COPY.consent.action}
        </button>
      </div>
    </>
  );
}
