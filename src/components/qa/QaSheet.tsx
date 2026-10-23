"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { F01, paletteFor } from "@/personas/persona";
import { EFFECT_MIN_LEVEL } from "@/lib/llm/contract";
import { qaRefillMessages, qaResetChat, qaSetFreeze, qaSetLevel, qaState, type QaState } from "@/lib/supabase/queries";
import type { Ledger } from "@/state/schema";
import { BUBBLE_EFFECTS, SCREEN_EFFECTS, uniqueReactions, type BubbleEffect } from "./qaPreview";
import sheet from "@/components/Sheet.module.css";
import styles from "./QaSheet.module.css";

export interface QaForce {
  effect?: BubbleEffect | null;
  screen?: string | null;
  reaction?: string | null;
}

export interface QaPreviewRequest {
  effect?: BubbleEffect;
  screen?: string;
  reaction?: string;
}

/**
 * The QA drawer, opened from one button in the chat header. It sits over the
 * chat (nothing navigates away), so a setting can be changed and the chat
 * carried straight on. Level, freeze and cap switches act at once; the effect
 * lab either previews an effect locally or forces it onto the next real reply.
 */
export function QaSheet({
  companionId,
  level,
  admin,
  ignoreCaps,
  force,
  onIgnoreCaps,
  onForce,
  onPreview,
  onLevel,
  onLedger,
  onClose,
  onToast,
}: {
  companionId: string;
  level: number;
  admin: boolean;
  ignoreCaps: boolean;
  force: QaForce | null;
  onIgnoreCaps: (v: boolean) => void;
  onForce: (f: QaForce | null) => void;
  onPreview: (p: QaPreviewRequest) => void;
  onLevel: (trustLevel: number, levelChangedAt: number) => void;
  onLedger: (l: Ledger) => void;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [mode, setMode] = useState<"preview" | "force">("preview");
  const [state, setState] = useState<QaState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showState, setShowState] = useState(false);

  const refresh = useCallback(() => {
    qaState(companionId)
      .then(setState)
      .catch(() => {});
  }, [companionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function pickLevel(n: number) {
    if (busy || n === level) return;
    setBusy(true);
    try {
      const r = await qaSetLevel(companionId, n);
      onLevel(r.trustLevel, r.levelChangedAt);
      onToast(`Level ${n}: ${F01.levels[n - 1].name}`);
      refresh();
    } catch {
      onToast("Couldn't set the level.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFreeze() {
    if (busy || !state) return;
    setBusy(true);
    try {
      const r = await qaSetFreeze(companionId, !state.frozen);
      setState({ ...state, frozen: r.frozen });
    } catch {
      onToast("Couldn't change the freeze.");
    } finally {
      setBusy(false);
    }
  }

  async function refill() {
    try {
      const r = await qaRefillMessages();
      onLedger(r.ledger);
      onToast("Messages refilled.");
    } catch {
      onToast("Couldn't refill.");
    }
  }

  async function reset() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    try {
      await qaResetChat(companionId);
      window.location.reload();
    } catch {
      onToast("Couldn't reset the chat.");
    }
  }

  function chip(kind: "effect" | "screen" | "reaction", id: string) {
    if (mode === "preview") {
      onPreview({ [kind]: id } as QaPreviewRequest);
      onClose();
      return;
    }
    const on = force?.[kind] === id;
    const next: QaForce = { ...(force ?? {}), [kind]: on ? null : id };
    const empty = !next.effect && !next.screen && !next.reaction;
    onForce(empty ? null : next);
  }

  const forced = (kind: "effect" | "screen" | "reaction", id: string) => mode === "force" && force?.[kind] === id;
  const forceCount = force ? [force.effect, force.screen, force.reaction].filter(Boolean).length : 0;

  return (
    <>
      <div className={sheet.scrim} onClick={onClose} data-testid="qa-scrim" />
      <div className={`${sheet.panel} ${styles.panel}`} role="dialog" aria-modal="true" aria-label="QA tools" data-testid="qa-sheet">
        <div className={styles.head}>
          <h2 className={styles.title}>QA</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.body}>
          <section className={styles.section}>
            <div className={styles.labelRow}>
              <span className={styles.label}>Trust level</span>
              <span className={styles.value}>{F01.levels[Math.min(5, Math.max(0, level - 1))].name}</span>
            </div>
            <div className={styles.levels} role="radiogroup" aria-label="Trust level">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={n === level} className={`${styles.level} ${n === level ? styles.on : ""}`} disabled={busy} onClick={() => void pickLevel(n)} data-testid={`qa-level-${n}`}>
                  {n}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <button type="button" role="switch" aria-checked={state?.frozen ?? false} className={styles.switchRow} onClick={() => void toggleFreeze()} disabled={!state || busy}>
              <span>
                <span className={styles.rowTitle}>Hold this level</span>
                <span className={styles.rowSub}>Trust stops moving while you chat</span>
              </span>
              <span className={`${styles.switch} ${state?.frozen ? styles.switchOn : ""}`} aria-hidden />
            </button>
            <button type="button" role="switch" aria-checked={ignoreCaps} className={styles.switchRow} onClick={() => onIgnoreCaps(!ignoreCaps)}>
              <span>
                <span className={styles.rowTitle}>Ignore daily caps</span>
                <span className={styles.rowSub}>Effects and screens can repeat</span>
              </span>
              <span className={`${styles.switch} ${ignoreCaps ? styles.switchOn : ""}`} aria-hidden />
            </button>
          </section>

          <section className={styles.section}>
            <div className={styles.labelRow}>
              <span className={styles.label}>Effects</span>
              <div className={styles.seg} role="radiogroup" aria-label="Effect mode">
                <button type="button" role="radio" aria-checked={mode === "preview"} className={mode === "preview" ? styles.segOn : ""} onClick={() => setMode("preview")}>
                  Preview
                </button>
                <button type="button" role="radio" aria-checked={mode === "force"} className={mode === "force" ? styles.segOn : ""} onClick={() => setMode("force")}>
                  Next reply{forceCount ? ` · ${forceCount}` : ""}
                </button>
              </div>
            </div>
            <p className={styles.hint}>{mode === "preview" ? "Tap one to see it in the chat. No message is sent." : "Tap to force onto Ira's next real reply, whatever the level or caps."}</p>

            <p className={styles.group}>Bubbles</p>
            <div className={styles.chips}>
              {BUBBLE_EFFECTS.map((e) => (
                <button key={e.id} type="button" className={`${styles.chip} ${forced("effect", e.id) ? styles.chipOn : ""}`} onClick={() => chip("effect", e.id)}>
                  {e.label}
                  <span className={styles.gate}>L{EFFECT_MIN_LEVEL[e.id]}</span>
                </button>
              ))}
            </div>
            <p className={styles.group}>Screens</p>
            <div className={styles.chips}>
              {SCREEN_EFFECTS.map((e) => (
                <button key={e.id} type="button" className={`${styles.chip} ${forced("screen", e.id) ? styles.chipOn : ""}`} onClick={() => chip("screen", e.id)}>
                  {e.label}
                </button>
              ))}
            </div>
            <p className={styles.group}>Reactions at this level</p>
            <div className={styles.chips}>
              {uniqueReactions(paletteFor(level, F01)).map((r) => (
                <button key={r} type="button" className={`${styles.chip} ${styles.emoji} ${forced("reaction", r) ? styles.chipOn : ""}`} onClick={() => chip("reaction", r)} aria-label={`Reaction ${r}`}>
                  {r}
                </button>
              ))}
            </div>
            {forceCount > 0 && (
              <button type="button" className={styles.linkBtn} onClick={() => onForce(null)}>
                Clear forced effects
              </button>
            )}
          </section>

          <section className={styles.section}>
            <button type="button" className={styles.disclose} aria-expanded={showState} onClick={() => setShowState((v) => !v)}>
              State
              <span aria-hidden>{showState ? "−" : "+"}</span>
            </button>
            {showState && state && (
              <dl className={styles.state} data-testid="qa-state">
                <dt>Points</dt>
                <dd>{state.points}{state.nextThreshold !== null ? ` of ${state.nextThreshold}` : " (top)"}</dd>
                <dt>Highest level</dt>
                <dd>{state.highestLevel}</dd>
                <dt>Relationship day</dt>
                <dd>{state.relationshipDay}</dd>
                <dt>Effects today</dt>
                <dd>{Object.keys(state.effectsToday).length ? Object.entries(state.effectsToday).map(([k, v]) => `${k} ${v}`).join(", ") : "none"}</dd>
                <dt>Screens today</dt>
                <dd>{state.screensToday}</dd>
                <dt>Cool-off / safety</dt>
                <dd>{state.coolOff ? "cool-off" : "no"} / {state.safetyMode ? "safety" : "no"}</dd>
              </dl>
            )}
          </section>

          <section className={styles.actions}>
            <button type="button" className={styles.action} onClick={() => void refill()}>
              Refill messages
            </button>
            <button type="button" className={`${styles.action} ${confirmReset ? styles.danger : ""}`} onClick={() => void reset()}>
              {confirmReset ? "Tap again to wipe this chat" : "Reset chat"}
            </button>
            {admin && (
              <Link href="/admin" className={styles.action}>
                Full console
              </Link>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
