"use client";

import { useCallback, useState } from "react";
import styles from "./QuestionTiles.module.css";

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    /* unsupported */
  }
}

export interface QuestionTilesProps {
  tags: readonly string[]; // 8, in display order
  labelFor: (tag: string) => string;
  picks: string[];
  onChange: (picks: string[]) => void;
}

/** 2x4 tap-toggle grid, max 3, shake + no-op on a 4th attempt. */
export function QuestionTiles({ tags, labelFor, picks, onChange }: QuestionTilesProps) {
  const [shaking, setShaking] = useState<string | null>(null);

  const toggle = useCallback(
    (tag: string) => {
      if (picks.includes(tag)) {
        onChange(picks.filter((p) => p !== tag));
        return;
      }
      if (picks.length >= 3) {
        setShaking(null);
        requestAnimationFrame(() => setShaking(tag));
        return;
      }
      vibrate(8);
      onChange([...picks, tag]);
    },
    [picks, onChange]
  );

  const full = picks.length >= 3;

  return (
    <div className={`${styles.tiles} ${full ? styles.full : ""}`}>
      {tags.map((tag) => {
        const pressed = picks.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            className={`${styles.tile} ${shaking === tag ? styles.shake : ""}`}
            aria-pressed={pressed}
            onClick={() => toggle(tag)}
            onAnimationEnd={() => setShaking((s) => (s === tag ? null : s))}
          >
            {labelFor(tag)}
          </button>
        );
      })}
    </div>
  );
}
