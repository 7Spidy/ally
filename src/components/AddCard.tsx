"use client";

import { COPY } from "@/lib/copy";
import type { AddCardKind } from "@/lib/addCard";
import { useSheet } from "@/state/useSheet";
import styles from "./AddCard.module.css";

export type { AddCardKind };

/**
 * The trailing card in the home carousel: an invite to start round two, or
 * (per spec §8.4) a static cap/exhausted state with no action and no `+`
 * pip. Tapping the add card opens the intro sheet — round two's actual
 * start (`START_ROUND2`) is dispatched by the intro sheet itself, owned by
 * another agent.
 */
export function AddCard({ kind, activeCount }: { kind: AddCardKind; activeCount: number }) {
  const { openSheet } = useSheet();

  if (kind === "cap") {
    return (
      <div className={styles.card}>
        <h2 className={styles.title}>{COPY.home.capCardTitle}</h2>
        <p className={styles.body}>{COPY.home.capCardBody}</p>
      </div>
    );
  }

  if (kind === "exhausted") {
    return (
      <div className={styles.card}>
        <h2 className={styles.title}>{COPY.home.exhaustedCardTitle}</h2>
        <p className={styles.body}>{COPY.home.exhaustedCardBody}</p>
      </div>
    );
  }

  const body = activeCount >= 1 ? COPY.home.addCardBodySome : COPY.home.addCardBodyNone;
  return (
    <div className={styles.card}>
      <h2 className={styles.title}>{COPY.home.addCardTitle}</h2>
      <p className={styles.body}>{body}</p>
      <button type="button" className="btn primary" onClick={() => openSheet("intro")}>
        {COPY.home.addCardAction}
      </button>
    </div>
  );
}
