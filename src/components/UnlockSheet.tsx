"use client";

import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import { useManifest } from "@/state/useManifest";
import { useToast } from "@/state/useToast";
import { Sheet } from "@/components/Sheet";
import { COPY, fill } from "@/lib/copy";
import { PRICE_SLOT_2, PRICE_SLOT_3 } from "@/lib/config";
import { now } from "@/lib/clock";
import styles from "./UnlockSheet.module.css";

/**
 * Slot 2/3 unlock, spec §8.2 step 3, §6 'unlock sheet'. `props.slot` is the
 * slot being unlocked (2 or 3) — the slot number *after* unlocking, matching
 * `ledger.unlock`'s own `slotsUnlocked + 1` bookkeeping.
 */
export function UnlockSheet({ slot }: { slot: number }) {
  const { dispatch } = useAlly();
  const { closeSheet } = useSheet();
  const { templates } = useManifest();
  const showToast = useToast();
  const router = useRouter();

  const price = slot === 2 ? PRICE_SLOT_2 : PRICE_SLOT_3;
  const body = slot === 2 ? COPY.unlockSheet.bodySlot2 : COPY.unlockSheet.bodySlot3;

  function handleUnlock() {
    // Mocked payment (spec §2): any tap succeeds locally.
    dispatch({ type: "UNLOCK_SLOT", amount: price, now: now() });
    showToast(COPY.unlockSheet.toast);
    // Continue the round-two sequence deferred from IntroSheet (§8.2 step 4).
    dispatch({ type: "START_ROUND2", templates });
    closeSheet();
    router.push("/onboarding/gender");
  }

  function handleNotNow() {
    // Reachable only before any payment happens (this button never appears
    // after a successful unlock), so no unlock needs rolling back here —
    // this just abandons the round-two attempt.
    closeSheet();
    router.push("/home");
  }

  return (
    <Sheet labelledBy="unlockSheetHeading">
      <h2 id="unlockSheetHeading" className={styles.heading}>
        {COPY.unlockSheet.heading}
      </h2>
      <p className={styles.body}>{body}</p>
      <div className={styles.priceRow}>
        <span>{COPY.unlockSheet.priceRow}</span>
        <span>{fill(COPY.unlockSheet.priceValue, { price })}</span>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={handleUnlock}>
          {COPY.unlockSheet.unlock}
        </button>
        <button type="button" className="btn quiet" onClick={handleNotNow}>
          {COPY.unlockSheet.notNow}
        </button>
      </div>
    </Sheet>
  );
}
