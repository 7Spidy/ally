"use client";

import { useState } from "react";
import { COPY, fill } from "@/lib/copy";
import styles from "./Composer.module.css";

export type ComposerVariant = "normal" | "oneLeft" | "empty" | "capped";

/**
 * Chat composer, gated per spec §11's ledger table. `capped` replaces the
 * composer outright; `empty` keeps the input visually present but any tap
 * on it opens the paywall instead of focusing; `oneLeft` is the normal
 * composer with a warning bar above it.
 */
export function Composer({
  variant,
  persona,
  onSend,
  onOpenPaywall,
}: {
  variant: ComposerVariant;
  persona: string;
  onSend: (text: string) => void;
  onOpenPaywall: () => void;
}) {
  const [text, setText] = useState("");

  if (variant === "capped") {
    return (
      <div className={styles.wrap}>
        <p className={styles.done}>{fill(COPY.chat.barPassCappedDone, { persona })}</p>
      </div>
    );
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  }

  return (
    <div className={styles.wrap}>
      {variant === "oneLeft" && (
        <div className={styles.bar}>
          <span>{COPY.chat.barOneLeft}</span>
          <button type="button" className={styles.barAction} onClick={onOpenPaywall}>
            {COPY.chat.barGetPass}
          </button>
        </div>
      )}
      {variant === "empty" && (
        <div className={styles.bar}>
          <span>{COPY.chat.barZeroLeft}</span>
          <button type="button" className={styles.barAction} onClick={onOpenPaywall}>
            {COPY.chat.barGetPass}
          </button>
        </div>
      )}
      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault();
          if (variant === "empty") {
            onOpenPaywall();
            return;
          }
          submit();
        }}
      >
        <input
          className={styles.input}
          value={text}
          placeholder="Message"
          aria-label="Message"
          readOnly={variant === "empty"}
          onFocus={() => {
            if (variant === "empty") onOpenPaywall();
          }}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          className={styles.send}
          aria-label="Send"
          disabled={variant !== "empty" && !text.trim()}
        >
          <svg viewBox="0 0 24 24">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}
