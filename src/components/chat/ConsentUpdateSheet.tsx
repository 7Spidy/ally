"use client";

import { Sheet } from "@/components/Sheet";
import { COPY } from "@/lib/copy";
import styles from "./ConsentUpdateSheet.module.css";

/** Shown once on the first open of a live chat when the latest consent is older than v2-live. */
export function ConsentUpdateSheet({ onContinue, onNotNow }: { onContinue: () => void; onNotNow: () => void }) {
  return (
    <Sheet labelledBy="consentUpdateHeading">
      <h2 id="consentUpdateHeading" className={styles.heading}>
        {COPY.live.consentHeading}
      </h2>
      <p className={styles.body}>{COPY.live.consentBody}</p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={onContinue}>
          {COPY.live.consentContinue}
        </button>
        <button type="button" className="btn quiet" onClick={onNotNow}>
          {COPY.live.consentNotNow}
        </button>
      </div>
    </Sheet>
  );
}
