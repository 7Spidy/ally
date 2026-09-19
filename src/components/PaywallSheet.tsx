"use client";

import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import { useToast } from "@/state/useToast";
import { Sheet } from "@/components/Sheet";
import { COPY, fill } from "@/lib/copy";
import { PRICE_DAY_PASS, PASS_HOURS } from "@/lib/config";
import { now, formatTimeIST } from "@/lib/clock";
import styles from "./PaywallSheet.module.css";

/**
 * Opened by chat's out-of-messages bar/tap (not by this work area). Spec
 * §11, §6 'paywall sheet'.
 */
export function PaywallSheet() {
  const { dispatch } = useAlly();
  const { closeSheet } = useSheet();
  const showToast = useToast();

  function handleGetPass() {
    // Mocked payment (spec §2): any tap succeeds locally.
    const t = now();
    dispatch({ type: "BUY_PASS", now: t });
    showToast(fill(COPY.paywallSheet.toast, { time: formatTimeIST(t + PASS_HOURS * 3600000) }));
    closeSheet();
    // Chat's own re-render picks up passActive() on its next read of
    // state.ledger — nothing else to do here.
  }

  function handleWait() {
    closeSheet();
  }

  return (
    <Sheet labelledBy="paywallSheetHeading">
      <h2 id="paywallSheetHeading" className={styles.heading}>
        {COPY.paywallSheet.heading}
      </h2>
      <p className={styles.body}>{COPY.paywallSheet.body}</p>
      <div className={styles.priceRow}>
        <span>{COPY.paywallSheet.priceRow}</span>
        <span>{fill(COPY.paywallSheet.priceValue, { price: PRICE_DAY_PASS })}</span>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={handleGetPass}>
          {COPY.paywallSheet.getPass}
        </button>
        <button type="button" className="btn quiet" onClick={handleWait}>
          {COPY.paywallSheet.wait}
        </button>
      </div>
    </Sheet>
  );
}
