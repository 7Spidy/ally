"use client";

import { useEffect, useRef } from "react";
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
 * Round-two entry point, spec §8.2 steps 1-4 (§6 'intro sheet').
 * Opened by the home add card (owned by another work area).
 *
 * Step 1's account gate runs BEFORE this sheet's own content is ever
 * shown, matching the spec's step order (account gate, then intro sheet,
 * then unlock, then onboarding) — not after a "Start" tap, which would
 * show "Someone new" copy to a user who hasn't created an account yet.
 * If there's no account, this sheet immediately hands off to the account
 * sheet (non-dismissible here, via `exchanges: 7`) with an `onSaved`
 * callback that reopens this same sheet — "on success, continue" — so the
 * user never has to tap the add card a second time.
 */
export function IntroSheet() {
  const { state, dispatch } = useAlly();
  const { closeSheet, openSheet, dismissForNavigation } = useSheet();
  const { templates } = useManifest();
  const router = useRouter();
  const gatedRef = useRef(false);

  const hasAccount = !!state.user.accountAt;

  useEffect(() => {
    if (hasAccount || gatedRef.current) return;
    gatedRef.current = true;
    dismissForNavigation();
    openSheet("account", { exchanges: 7, onSaved: () => openSheet("intro") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccount]);

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
    if (activeList.length >= state.ledger.slotsUnlocked) {
      dismissForNavigation();
      openSheet("unlock", { slot: state.ledger.slotsUnlocked + 1 });
      return;
    }
    dispatch({ type: "START_ROUND2", templates });
    dismissForNavigation();
    router.replace("/onboarding/gender");
  }

  function handleNotNow() {
    closeSheet();
  }

  if (!hasAccount) return null;

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
