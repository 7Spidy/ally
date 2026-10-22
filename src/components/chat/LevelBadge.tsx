"use client";

import styles from "./LevelBadge.module.css";

export const LEVEL_COUNT = 6;

/**
 * A one-second pill under the chat header that names the current level
 * ("Acquaintance"), with six segments, the first `level` filled. Never shows
 * "L1" or a digit on screen; screen readers hear "<name>, level <n> of 6".
 * Absolutely positioned inside a zero-height anchor, so nothing shifts.
 */
export function LevelBadge({ name, level }: { name: string; level: number }) {
  const n = Math.min(LEVEL_COUNT, Math.max(1, Math.round(level)));
  return (
    <div className={styles.anchor}>
      <div className={styles.badge} role="status" data-testid="level-badge">
        <span className={styles.name} data-testid="level-badge-name" aria-hidden>
          {name}
        </span>
        <span className={styles.segments} aria-hidden>
          {Array.from({ length: LEVEL_COUNT }, (_, i) => (
            <span key={i} className={`${styles.seg} ${i < n ? styles.filled : ""}`} />
          ))}
        </span>
        <span className={styles.sr}>{`${name}, level ${n} of ${LEVEL_COUNT}`}</span>
      </div>
    </div>
  );
}
