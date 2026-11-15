"use client";

import { useEffect, useRef } from "react";
import { useSheet } from "@/state/useSheet";
import { onboardingSheets } from "@/components/sheets/onboardingSheets";
import { hubSheets } from "@/components/sheets/hubSheets";
import { ledgerSheets } from "@/components/sheets/ledgerSheets";
import styles from "./Sheet.module.css";

const REGISTRY = { ...onboardingSheets, ...hubSheets, ...ledgerSheets };

/**
 * Reusable scrim + panel wrapper. Traps focus while open (spec §9.2).
 * `onScrimTap` makes a tap outside the panel close it; sheets that must be
 * answered (the blocking account sheet, consent, the age checks) leave it off.
 * Individual sheets (ConfirmSheet, AccountSheet, IntroSheet, LeaveSheet, SwitcherSheet, PartSheet, DeleteSheet) render
 * their own content inside this and are wired into `SheetHost` below.
 */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({ children, labelledBy, onScrimTap }: { children: React.ReactNode; labelledBy?: string; onScrimTap?: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    // Looked up when Tab is pressed, not once on mount: a sheet's controls change as it moves between steps.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <div className={styles.scrim} data-testid="sheet-scrim" onClick={onScrimTap} />
      <div className={styles.panel} ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </>
  );
}

/**
 * Renders whichever sheet is on top of the stack, if any. Extend the
 * switch below as each named sheet component is built.
 */
export function SheetHost() {
  const { top } = useSheet();
  if (!top) return null;

  const Component = REGISTRY[top.name];
  if (!Component) return null;
  return <Component {...top.props} />;
}
