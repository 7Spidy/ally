"use client";

import { useEffect, useState } from "react";
import styles from "./ContextCard.module.css";

export const CONTEXT_CARD_MS = 5000;

/**
 * Frosted card under the header: an optional level name (level-up only) and
 * a state line, a 5 s progress bar, then it fades out. Tap dismisses. Never
 * shows a number and never says anything about the user's mood.
 */
export function ContextCard({ title, line, onGone }: { title?: string; line: string; onGone: () => void }) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fade = setTimeout(() => setFading(true), CONTEXT_CARD_MS);
    const gone = setTimeout(onGone, CONTEXT_CARD_MS + 400);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      type="button"
      className={`${styles.card} ${fading ? styles.fading : ""}`}
      data-testid="context-card"
      onClick={() => {
        setFading(true);
        setTimeout(onGone, 200);
      }}
    >
      {title && <span className={styles.title}>{title}</span>}
      <span className={styles.line}>{line}</span>
      <span className={styles.bar} aria-hidden>
        <span className={styles.fill} />
      </span>
    </button>
  );
}
