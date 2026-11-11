"use client";

import { useRouter } from "next/navigation";
import { COPY } from "@/lib/copy";
import { addCardTarget, type AddCardKind } from "@/lib/addCard";
import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import styles from "./AddCard.module.css";

export type { AddCardKind };

/**
 * The trailing card in the home carousel: an invite to start round two, or
 * (per spec §8.4) a static cap/exhausted state with no action and no `+`
 * pip. Tapping the add card opens the intro sheet (round two's actual
 * start, `START_ROUND2`, is dispatched by the intro sheet itself), or, when
 * the plan has no free slot, the plans screen.
 */
export function AddCard({ kind, activeCount }: { kind: AddCardKind; activeCount: number }) {
  const { openSheet } = useSheet();
  const router = useRouter();
  const { state } = useAlly();

  // At the plan's limit the button leads to the plans screen instead of the intro sheet.
  function start() {
    const target = addCardTarget(activeCount, state.entitlement);
    if (target === "plans-newally") router.push("/plans?from=newally");
    else if (target === "plans-locked") router.push("/plans?from=locked");
    else if (target === "intro") openSheet("intro");
  }

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
      <button type="button" className="btn primary" onClick={start}>
        {COPY.home.addCardAction}
      </button>
    </div>
  );
}
