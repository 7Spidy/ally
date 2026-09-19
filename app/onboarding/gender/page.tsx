"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { ManifestGate } from "@/components/ManifestGate";
import { pool } from "@/lib/selectors";
import { COPY } from "@/lib/copy";
import type { Gender } from "@/state/schema";
import { invalidationFor } from "../_lib/invalidate";
import { useOnboardingToast } from "../_lib/Toast";
import styles from "./page.module.css";

export default function GenderPage() {
  return (
    <ManifestGate>
      <GenderScreen />
    </ManifestGate>
  );
}

function GenderScreen() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const { templates } = useManifest();
  const toast = useOnboardingToast();
  const [committing, setCommitting] = useState(false);

  const isRound2 = state.flow?.kind === "round2";
  const womanPool = useMemo(() => pool(state, templates, "woman").length, [state, templates]);
  const manPool = useMemo(() => pool(state, templates, "man").length, [state, templates]);

  if (!state.flow) return null;

  function choose(g: Gender) {
    if (!state.flow || committing) return;
    if (isRound2 && ((g === "woman" && womanPool === 0) || (g === "man" && manPool === 0))) return;
    setCommitting(true);
    if (g !== state.flow.deckGender) {
      const { patch, changed } = invalidationFor("gender", state.flow);
      if (changed && patch) {
        dispatch({ type: "INVALIDATE", patch });
        toast(COPY.recompute.toast);
      }
    }
    dispatch({ type: "SET_GENDER", gender: g });
    setTimeout(() => {
      router.push(isRound2 ? "/onboarding/questions/disclosure" : "/onboarding/name");
    }, 200);
  }

  const womanDisabled = isRound2 && womanPool === 0;
  const manDisabled = isRound2 && manPool === 0;

  return (
    <div className={styles.wrap}>
      <h1 className={`q ${styles.q}`}>{COPY.gender.question}</h1>
      <button
        type="button"
        className={`${styles.panel} ${state.flow.deckGender === "woman" ? styles.sel : ""}`}
        aria-pressed={state.flow.deckGender === "woman"}
        disabled={womanDisabled}
        onClick={() => choose("woman")}
      >
        <span className={styles.label}>{COPY.gender.optionWoman}</span>
        {womanDisabled && <span className={styles.empty}>{COPY.round2.genderPoolEmpty}</span>}
      </button>
      <button
        type="button"
        className={`${styles.panel} ${state.flow.deckGender === "man" ? styles.sel : ""}`}
        aria-pressed={state.flow.deckGender === "man"}
        disabled={manDisabled}
        onClick={() => choose("man")}
      >
        <span className={styles.label}>{COPY.gender.optionMan}</span>
        {manDisabled && <span className={styles.empty}>{COPY.round2.genderPoolEmpty}</span>}
      </button>
      {isRound2 && <p className="sub">{COPY.round2.subLine}</p>}
    </div>
  );
}
