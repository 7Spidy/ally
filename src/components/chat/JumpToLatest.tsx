"use client";

import { COPY } from "@/lib/copy";
import styles from "./JumpToLatest.module.css";

/**
 * A round button above the composer, shown when the list is scrolled well
 * above the bottom. A dot says a message arrived while you were up there.
 */
export function JumpToLatest({ visible, unseen, onClick }: { visible: boolean; unseen: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.jump}
      data-visible={visible ? "true" : "false"}
      data-testid="jump-latest"
      aria-label={COPY.chat.jumpLatest}
      tabIndex={visible ? 0 : -1}
      aria-hidden={visible ? undefined : true}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
      {unseen && <span className={styles.dot} data-testid="jump-dot" />}
    </button>
  );
}
