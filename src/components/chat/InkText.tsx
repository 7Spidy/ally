"use client";

import { useState } from "react";
import { COPY } from "@/lib/copy";
import styles from "./InkText.module.css";

const key = (id: number | undefined) => `ally_ink:${id ?? "x"}`;

function wasRevealed(id: number | undefined): boolean {
  try {
    return window.localStorage.getItem(key(id)) === "1";
  } catch {
    return false;
  }
}

/** Blurred text with drifting speckle. Reveals on pointerdown or a swipe across it. */
export function InkText({ id, text }: { id: number | undefined; text: string }) {
  const [revealed, setRevealed] = useState(() => (typeof window === "undefined" ? false : wasRevealed(id)));

  function reveal() {
    if (revealed) return;
    setRevealed(true);
    try {
      window.localStorage.setItem(key(id), "1");
    } catch {
      /* storage blocked: revealed for this view only */
    }
  }

  return (
    <span
      className={styles.ink}
      data-testid="ink"
      data-revealed={revealed ? "true" : "false"}
      onPointerDown={reveal}
      onPointerMove={(e) => {
        if (e.buttons > 0 || e.pointerType === "touch") reveal();
      }}
      onClick={reveal}
    >
      <span className={revealed ? styles.textShown : styles.textHidden}>{text}</span>
      {!revealed && <span className={styles.speckle} aria-hidden />}
      {!revealed && <span className={styles.hint}>{COPY.chat.inkHint}</span>}
    </span>
  );
}
