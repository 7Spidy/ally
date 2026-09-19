"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import { NO_BACK_STEPS, QUESTION_STEPS, backTargetFor, stepFromPathname } from "./_lib/steps";
import { OnboardingToastProvider } from "./_lib/Toast";
import styles from "./layout.module.css";

const BACK_ICON = (
  <svg viewBox="0 0 24 24">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
const X_ICON = (
  <svg viewBox="0 0 24 24">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/**
 * Phone-chrome wrapper shared by every /onboarding/* route: the Q5-Q11
 * progress rule, and back/X handling per spec §9.1. Back targets are
 * explicit `router.push`, never `router.back()` — the actual history
 * stack depends on how the user arrived. Hardware back is intercepted via
 * a popstate listener that performs the same action as the on-screen
 * control, so they never disagree. Only acts when the sheet stack is
 * empty — SheetProvider owns popstate while a sheet is open.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const { openSheet, stack } = useSheet();

  const step = stepFromPathname(pathname);
  const isRound2 = state.flow?.kind === "round2";

  // Keep flow.step in sync with the actual route, for boot-resume.
  useEffect(() => {
    if (step && state.flow && state.flow.step !== step) {
      dispatch({ type: "SET_FLOW_STEP", step });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const handleBack = useCallback(() => {
    if (isRound2) {
      openSheet("leave");
      return;
    }
    if (!step) return;
    const target = backTargetFor(step);
    if (target) router.push(target);
  }, [isRound2, openSheet, step, router]);

  useEffect(() => {
    function onPopState() {
      if (stack.length > 0) return; // SheetProvider owns this while a sheet is open
      handleBack();
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [stack.length, handleBack]);

  const qIndex = step ? QUESTION_STEPS.indexOf(step) : -1;
  const showRule = qIndex >= 0;
  const showBack = !!step && !NO_BACK_STEPS.has(step);

  return (
    <OnboardingToastProvider>
      <div className={styles.screen}>
        {showRule && (
          <div className={styles.rule} aria-hidden="true">
            <i style={{ width: `${((qIndex + 1) / QUESTION_STEPS.length) * 100}%` }} />
          </div>
        )}
        {showBack && (
          <button type="button" className="icon-btn back" onClick={handleBack} aria-label={isRound2 ? "Leave" : "Back"}>
            {isRound2 ? X_ICON : BACK_ICON}
          </button>
        )}
        {children}
      </div>
    </OnboardingToastProvider>
  );
}
