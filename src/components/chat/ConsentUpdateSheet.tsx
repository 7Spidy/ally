"use client";

import { Sheet } from "@/components/Sheet";
import { COPY, fill } from "@/lib/copy";
import styles from "./ConsentUpdateSheet.module.css";

/** Shown once on the first open of a live chat when the newest consent is not one of LIVE_OK_VERSIONS (the September consent). `obj` is "her" or "him". */
export function ConsentUpdateSheet({ persona, obj, onContinue, onNotNow }: { persona: string; obj: string; onContinue: () => void; onNotNow: () => void }) {
  return (
    <Sheet labelledBy="consentUpdateHeading">
      <h2 id="consentUpdateHeading" className={styles.heading}>
        {COPY.live.consentHeading}
      </h2>
      <p className={styles.body}>{fill(COPY.live.consentBody, { persona, obj })}</p>
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
