"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { needsTiebreak, scoreCores } from "@/lib/engine";
import { COPY } from "@/lib/copy";
import { QuestionCards } from "../../_components/QuestionCards";
import { invalidationFor } from "../../_lib/invalidate";
import { ADVANCE_MS } from "../../_lib/useCardQuestion";
import { useOnboardingToast } from "../../_lib/Toast";
import styles from "./page.module.css";

/**
 * Conditional screen between Q11 and matching, shown only when the first
 * five answers leave the top two cores too close to call. Two messages, one
 * per core, in random left/right order per mount. Not part of the Q5-Q11
 * progress pips.
 */
export default function TiebreakPage() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const toast = useOnboardingToast();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [flipped] = useState(() => Math.random() < 0.5);

  const flow = state.flow;
  const tb = flow?.answers.tb ?? null;

  // The pair is read from the answers without the tiebreak, so it stays the
  // same pair after the user has chosen (coming back from matching).
  const pair = useMemo(() => {
    if (!flow) return null;
    const base = { ...flow.answers, tb: null };
    return needsTiebreak(scoreCores(base), base);
  }, [flow]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Reached without a close call (a direct visit): nothing to ask.
  useEffect(() => {
    if (flow && !pair && tb === null) router.replace("/onboarding/matching");
  }, [flow, pair, tb, router]);

  if (!flow || !pair) return null;

  const cores = flipped ? ([pair[1], pair[0]] as const) : pair;
  const options = cores.map((c) => COPY.tiebreak.lines[c]);
  const index = tb ? cores.indexOf(tb) : -1;

  function select(i: number) {
    if (!flow) return;
    const winner = cores[i];
    if (winner !== flow.answers.tb) {
      const { patch, changed } = invalidationFor("tb", flow);
      if (changed && patch) {
        dispatch({ type: "INVALIDATE", patch });
        toast(COPY.recompute.toast);
      }
    }
    dispatch({ type: "SET_ANSWER", key: "tb", value: winner });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.push("/onboarding/matching"), ADVANCE_MS);
  }

  return (
    <div className="stack">
      <h1 className="q">{COPY.tiebreak.question}</h1>
      <QuestionCards options={options} index={index < 0 ? null : index} onSelect={select} ariaLabel={COPY.tiebreak.question} cardClassName={styles.message} />
    </div>
  );
}
