"use client";

import { COPY } from "@/lib/copy";
import { QuestionCards } from "../../_components/QuestionCards";
import { useCardQuestion } from "../../_lib/useCardQuestion";

export default function WarmthPage() {
  const { flow, index, select, isRound2 } = useCardQuestion("q6", "/onboarding/questions/push");

  if (!flow) return null;

  return (
    <div className="stack">
      <h1 className="q">{COPY.q6.question}</h1>
      {isRound2 && <p className="sub">{COPY.round2.subLine}</p>}
      <QuestionCards options={COPY.q6.options} index={index} onSelect={select} ariaLabel={COPY.q6.question} />
    </div>
  );
}
