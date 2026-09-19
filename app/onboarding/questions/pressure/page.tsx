"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAlly } from "@/state/useAlly";
import { PRESSURES } from "@/lib/engine";
import { COPY } from "@/lib/copy";
import { QuestionDial } from "../../_components/QuestionDial";
import { invalidationFor } from "../../_lib/invalidate";
import { useOnboardingToast } from "../../_lib/Toast";

// COPY.q10.stops is in PRESSURES order (money, health, head, alone, notgood, change).
export default function PressurePage() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const toast = useOnboardingToast();
  const stored = state.flow?.answers.q10 ?? null;
  const [index, setIndex] = useState<number | null>(stored ? PRESSURES.indexOf(stored) : null);

  if (!state.flow) return null;
  const isRound2 = state.flow.kind === "round2";
  const value = index != null ? PRESSURES[index] : null;

  function onContinue() {
    if (!state.flow || value == null) return;
    if (value !== state.flow.answers.q10) {
      const { patch, changed } = invalidationFor("q10", state.flow);
      if (changed && patch) {
        dispatch({ type: "INVALIDATE", patch });
        toast(COPY.recompute.toast);
      }
    }
    dispatch({ type: "SET_ANSWER", key: "q10", value });
    router.push("/onboarding/questions/interests");
  }

  return (
    <>
      <div className="stack">
        <h1 className="q">{COPY.q10.question}</h1>
        {isRound2 && <p className="sub">{COPY.round2.subLine}</p>}
        <QuestionDial labels={COPY.q10.stops} index={index} onChange={setIndex} ariaLabel={COPY.q10.question} />
      </div>
      <div className="actions">
        <button type="button" className="btn primary" disabled={value == null} onClick={onContinue}>
          {COPY.consent.action}
        </button>
      </div>
    </>
  );
}
