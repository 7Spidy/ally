"use client";

import { Sheet } from "@/components/Sheet";
import { COPY, fill } from "@/lib/copy";
import styles from "./ConsentUpdateSheet.module.css";

/** Shown once on the first open of a live chat when the latest consent is older than LIVE_CONSENT_VERSION. */
export function ConsentUpdateSheet({ persona, onContinue, onNotNow }: { persona: string; onContinue: () => void; onNotNow: () => void }) {
  return (
    <Sheet labelledBy="consentUpdateHeading">
      <h2 id="consentUpdateHeading" className={styles.heading}>
        {fill(COPY.live.consentHeading, { persona })}
      </h2>
      <p className={styles.body}>{fill(COPY.live.consentBody, { persona })}</p>
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
