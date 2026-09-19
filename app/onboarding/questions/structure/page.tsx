"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAlly } from "@/state/useAlly";
import { STRUCTURE_STOPS } from "@/lib/engine";
import { COPY } from "@/lib/copy";
import { QuestionSlider } from "../../_components/QuestionSlider";
import { invalidationFor } from "../../_lib/invalidate";
import { useOnboardingToast } from "../../_lib/Toast";

function toPos(val: number | null) {
  if (val == null) return null;
  const i = STRUCTURE_STOPS.indexOf(val as (typeof STRUCTURE_STOPS)[number]);
  return i < 0 ? null : i / 3;
}

export default function StructurePage() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const toast = useOnboardingToast();
  const [pos, setPos] = useState<number | null>(toPos(state.flow?.answers.q8 ?? null));

  if (!state.flow) return null;
  const isRound2 = state.flow.kind === "round2";
  const stepIndex = pos == null ? -1 : Math.round(pos * 3);
  const value = stepIndex >= 0 ? STRUCTURE_STOPS[stepIndex] : null;

  function onContinue() {
    if (!state.flow || value == null) return;
    if (value !== state.flow.answers.q8) {
      const { patch, changed } = invalidationFor("q8", state.flow);
      if (changed && patch) {
        dispatch({ type: "INVALIDATE", patch });
        toast(COPY.recompute.toast);
      }
    }
    dispatch({ type: "SET_ANSWER", key: "q8", value });
    router.push("/onboarding/questions/nostalgia");
  }

  return (
    <>
      <div className="stack">
        <h1 className="q">{COPY.q8.question}</h1>
        {isRound2 && <p className="sub">{COPY.round2.subLine}</p>}
        <QuestionSlider stops={4} position={pos} onChange={setPos} labels={COPY.q8.stops} ariaLabel={COPY.q8.question} />
      </div>
      <div className="actions">
        <button type="button" className="btn primary" disabled={value == null} onClick={onContinue}>
          {COPY.consent.action}
        </button>
      </div>
    </>
  );
}
