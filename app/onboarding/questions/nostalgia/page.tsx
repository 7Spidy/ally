"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAlly } from "@/state/useAlly";
import { COPY } from "@/lib/copy";
import { QuestionSlider } from "../../_components/QuestionSlider";
import { invalidationFor } from "../../_lib/invalidate";
import { useOnboardingToast } from "../../_lib/Toast";

export default function NostalgiaPage() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const toast = useOnboardingToast();
  const stored = state.flow?.answers.q9 ?? null;
  const [pos, setPos] = useState<number | null>(stored == null ? null : 1 - stored);

  if (!state.flow) return null;
  const isRound2 = state.flow.kind === "round2";
  const value = pos == null ? null : 1 - pos;

  function onContinue() {
    if (!state.flow || value == null) return;
    if (value !== state.flow.answers.q9) {
      const { patch, changed } = invalidationFor("q9", state.flow);
      if (changed && patch) {
        dispatch({ type: "INVALIDATE", patch });
        toast(COPY.recompute.toast);
      }
    }
    dispatch({ type: "SET_ANSWER", key: "q9", value });
    router.push("/onboarding/questions/pressure");
  }

  return (
    <>
      <div className="stack">
        <h1 className="q">{COPY.q9.question}</h1>
        {isRound2 && <p className="sub">{COPY.round2.subLine}</p>}
        <QuestionSlider stops={null} position={pos} onChange={setPos} labels={[COPY.q9.poleLeft, COPY.q9.poleRight]} ariaLabel={COPY.q9.question} />
      </div>
      <div className="actions">
        <button type="button" className="btn primary" disabled={value == null} onClick={onContinue}>
          {COPY.consent.action}
        </button>
      </div>
    </>
  );
}
