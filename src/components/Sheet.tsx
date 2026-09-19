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
 * Individual sheets (ConfirmSheet, AccountSheet, IntroSheet, UnlockSheet,
 * LeaveSheet, PaywallSheet, SwitcherSheet, PartSheet, DeleteSheet) render
 * their own content inside this and are wired into `SheetHost` below.
 */
export function Sheet({ children, labelledBy }: { children: React.ReactNode; labelledBy?: string }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !focusable.length) return;
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
      <div className={styles.scrim} />
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
