"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { COPY } from "@/lib/copy";
import { invalidationFor } from "./invalidate";
import { useOnboardingToast } from "./Toast";

/** Selecting a card waits this long before moving on, so the check mark registers. */
export const ADVANCE_MS = 350;

function vibrate(pattern: number) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    /* unsupported: silent */
  }
}

/**
 * Shared behaviour of the five card questions (Q5 to Q9): store the option
 * index, run the answer-invalidation rule (with its toast), then auto-advance
 * after 350 ms. Tapping another card inside that window restarts the timer.
 */
export function useCardQuestion(key: "q5" | "q6" | "q7" | "q8" | "q9", next: string) {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const toast = useOnboardingToast();
  const stored = state.flow?.answers[key] ?? null;
  const [index, setIndex] = useState<number | null>(stored != null && Number.isInteger(stored) && stored >= 0 && stored <= 3 ? stored : null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function select(i: number) {
    const flow = state.flow;
    if (!flow) return;
    setIndex(i);
    vibrate(8);
    if (i !== flow.answers[key]) {
      const { patch, changed } = invalidationFor(key, flow);
      if (changed && patch) {
        dispatch({ type: "INVALIDATE", patch });
        toast(COPY.recompute.toast);
      }
    }
    dispatch({ type: "SET_ANSWER", key, value: i });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.push(next), ADVANCE_MS);
  }

  return { flow: state.flow, index, select, isRound2: state.flow?.kind === "round2" };
}
