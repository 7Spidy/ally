"use client";

import { useRef, useState } from "react";
import styles from "./QuestionCards.module.css";

export interface QuestionCardsProps {
  options: readonly string[];
  /** The selected option, or null before the user has answered. */
  index: number | null;
  onSelect: (index: number) => void;
  ariaLabel: string;
  /** Extra class on each card, for screens that restyle them (the tiebreak's message bubbles). */
  cardClassName?: string;
}

/**
 * A vertical stack of full-width option cards, one per answer (Q5 to Q9).
 * A radio group with roving tabindex: arrow keys move focus, Space or Enter
 * selects. The page owns what selecting does (answer, invalidation, advance).
 */
export function QuestionCards({ options, index, onSelect, ariaLabel, cardClassName }: QuestionCardsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focused, setFocused] = useState(index ?? 0);
  const tabStop = Math.min(index ?? focused, options.length - 1);

  function move(to: number) {
    const n = (to + options.length) % options.length;
    setFocused(n);
    refs.current[n]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") move(i + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(options.length - 1);
    else return;
    e.preventDefault();
  }

  return (
    <div className={styles.cards} role="radiogroup" aria-label={ariaLabel}>
      {options.map((label, i) => {
        const selected = index === i;
        return (
          <button
            key={label}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={i === tabStop ? 0 : -1}
            className={cardClassName ? `${styles.card} ${cardClassName}` : styles.card}
            onClick={() => onSelect(i)}
            onFocus={() => setFocused(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className={styles.label}>{label}</span>
            <svg className={styles.check} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
