"use client";

import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import { useManifest } from "@/state/useManifest";
import { Sheet } from "@/components/Sheet";
import { active } from "@/lib/selectors";
import { firstNameFromFull } from "@/lib/engine";
import { COPY, fill } from "@/lib/copy";
import styles from "./IntroSheet.module.css";

/**
 * Round-two entry point, spec §8.2 steps 1-3 (§6 'intro sheet').
 * Opened by the home add card (owned by another work area).
 */
export function IntroSheet() {
  const { state, dispatch } = useAlly();
  const { closeSheet, openSheet } = useSheet();
  const { templates } = useManifest();
  const router = useRouter();

  const activeList = active(state)
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);

  function nameFor(templateId: string): string {
    const t = templates.find((x) => x.id === templateId);
    return t ? firstNameFromFull(t.name) : "";
  }

  let body2: string | null = null;
  if (activeList.length === 1) {
    body2 = fill(COPY.introSheet.body2One, { a: nameFor(activeList[0].templateId) });
  } else if (activeList.length >= 2) {
    body2 = fill(COPY.introSheet.body2Two, {
      a: nameFor(activeList[0].templateId),
      b: nameFor(activeList[1].templateId),
    });
  }

  function handleStart() {
    if (!state.user.accountAt) {
      // Spec §8.2 step 1 wants the account sheet non-dismissible here, with
      // round two continuing automatically once it succeeds. The account
      // sheet is owned by another work area and doesn't accept a
      // continuation callback, so we degrade gracefully instead: open it
      // and stop. The user taps the add card again once accountAt is set,
      // which reopens this sheet and this time falls through to the next
      // check. See report for details.
      closeSheet();
      openSheet("account");
      return;
    }
    if (activeList.length >= state.ledger.slotsUnlocked) {
      closeSheet();
      openSheet("unlock", { slot: state.ledger.slotsUnlocked + 1 });
      return;
    }
    dispatch({ type: "START_ROUND2", templates });
    closeSheet();
    router.push("/onboarding/gender");
  }

  function handleNotNow() {
    closeSheet();
  }

  return (
    <Sheet labelledBy="introSheetHeading">
      <h2 id="introSheetHeading" className={styles.heading}>
        {COPY.introSheet.heading}
      </h2>
      <p className={styles.body}>{COPY.introSheet.body1}</p>
      {body2 && <p className={styles.body}>{body2}</p>}
      <div className="actions">
        <button type="button" className="btn primary" onClick={handleStart}>
          {COPY.introSheet.start}
        </button>
        <button type="button" className="btn quiet" onClick={handleNotNow}>
          {COPY.introSheet.notNow}
        </button>
      </div>
    </Sheet>
  );
}
