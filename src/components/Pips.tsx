"use client";

import { useRef } from "react";
import type { Companion } from "@/state/schema";
import type { Template } from "@/lib/engine";
import { Avatar } from "@/components/Avatar";
import styles from "./Pips.module.css";

export interface PipItem {
  key: string; // companion id, or 'add' for the trailing card
  companion?: Companion;
  template?: Template;
}

/**
 * One 34px pip per active companion plus a trailing `+` (spec §10.3),
 * omitted when the add-card slot is a static cap/exhausted card. The
 * ringed pip mirrors whichever card is centred in the carousel. Arrow
 * keys move focus between pips; Enter selects the focused one.
 */
export function Pips({
  items,
  showPlus,
  centeredKey,
  onScrollTo,
  onOpen,
}: {
  items: PipItem[];
  showPlus: boolean;
  centeredKey: string;
  /** A mouse click on a pip: scroll the carousel to that card (spec §10.3). */
  onScrollTo: (key: string) => void;
  /** Enter on a focused pip: open that card (spec §10.3). Detected via
   *  MouseEvent.detail === 0, the standard signal a click event came from
   *  a key press rather than a pointer. */
  onOpen: (key: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const buttons = rowRef.current?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons || !buttons.length) return;
    const list = Array.from(buttons);
    const idx = list.findIndex((b) => b === document.activeElement);
    const next = e.key === "ArrowRight" ? Math.min(list.length - 1, idx + 1) : Math.max(0, idx - 1);
    list[next]?.focus();
  }

  return (
    <div className={styles.row} ref={rowRef} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`${styles.pip} ${centeredKey === item.key ? styles.ringed : ""}`}
          aria-label={item.template ? item.template.name : "Companion"}
          aria-current={centeredKey === item.key}
          onClick={(e) => (e.detail === 0 ? onOpen(item.key) : onScrollTo(item.key))}
        >
          {item.template && <Avatar template={item.template} size={30} />}
        </button>
      ))}
      {showPlus && (
        <button
          type="button"
          className={`${styles.plus} ${centeredKey === "add" ? styles.ringed : ""}`}
          aria-label="Meet someone new"
          aria-current={centeredKey === "add"}
          onClick={(e) => (e.detail === 0 ? onOpen("add") : onScrollTo("add"))}
        >
          +
        </button>
      )}
    </div>
  );
}
