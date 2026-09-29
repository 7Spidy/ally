"use client";

import { COPY } from "@/lib/copy";
import { QuestionCards } from "../../_components/QuestionCards";
import { useCardQuestion } from "../../_lib/useCardQuestion";

export default function StructurePage() {
  const { flow, index, select, isRound2 } = useCardQuestion("q8", "/onboarding/questions/offday");

  if (!flow) return null;

  return (
    <div className="stack">
      <h1 className="q">{COPY.q8.question}</h1>
      {isRound2 && <p className="sub">{COPY.round2.subLine}</p>}
      <QuestionCards options={COPY.q8.options} index={index} onSelect={select} ariaLabel={COPY.q8.question} />
    </div>
  );
}
