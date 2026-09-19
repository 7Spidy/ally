"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import { useManifest } from "@/state/useManifest";
import { excludedFaces } from "@/lib/selectors";
import { computeCore } from "@/lib/engine";
import { now } from "@/lib/clock";
import type { Answers, Companion, Gender } from "@/state/schema";
import styles from "./DebugPanel.module.css";

const CLOCK_OFFSET_KEY = "ally_debug_clock_offset_ms";

function applyClockOffset(deltaMs: number) {
  const current = Number(window.localStorage.getItem(CLOCK_OFFSET_KEY) || "0");
  const next = current + deltaMs;
  window.localStorage.setItem(CLOCK_OFFSET_KEY, String(next));
  window.__allyClock = () => Date.now() + next;
}

// Re-apply any persisted offset on load so a dev-tools refresh keeps the skip.
if (typeof window !== "undefined") {
  const persisted = Number(window.localStorage.getItem(CLOCK_OFFSET_KEY) || "0");
  if (persisted) window.__allyClock = () => Date.now() + persisted;
}

function randomAnswers(): Answers {
  const rand = () => Math.random();
  const pressures: Answers["q10"][] = ["money", "health", "head", "alone", "notgood", "change"];
  return {
    q5: [0.1, 0.4, 0.7, 0.95][Math.floor(rand() * 4)],
    q6: rand(),
    q7: rand(),
    q8: [0.1, 0.38, 0.68, 0.95][Math.floor(rand() * 4)],
    q9: rand(),
    q10: pressures[Math.floor(rand() * pressures.length)],
    q11: [],
  };
}

export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const taps = useRef<number[]>([]);
  const pathname = usePathname();
  const { state, dispatch } = useAlly();
  const { stack } = useSheet();
  const { templates } = useManifest();

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (e.clientX > 60 || e.clientY > 60) return;
      const t = Date.now();
      taps.current = [...taps.current.filter((x) => t - x < 600), t];
      if (taps.current.length >= 3) {
        taps.current = [];
        setOpen((o) => !o);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  if (!open) return null;

  const nowMs = now();
  const excluded = [...excludedFaces(state)];
  const offset = Number(window.localStorage.getItem(CLOCK_OFFSET_KEY) || "0");

  function seedCompanion() {
    const allowed = templates.filter((t) => !excludedFaces(state).has(t.id));
    if (!allowed.length) return;
    const t = allowed[Math.floor(Math.random() * allowed.length)];
    const answers = randomAnswers();
    const core = computeCore(answers);
    const companion: Companion = {
      id: "c_" + now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      templateId: t.id,
      deckGender: t.gender as Gender,
      answers,
      core,
      createdAt: now(),
      lastOpenedAt: now(),
      status: "active",
      partedAt: null,
      purgeAt: null,
      messages: [],
      exchanges: 0,
      unread: 0,
      notify: true,
      sound: true,
    };
    dispatch({ type: "DEBUG_SEED_COMPANION", companion });
  }

  function copyState() {
    const text = JSON.stringify(state, null, 2);
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  function resetSession() {
    window.localStorage.clear();
    window.location.reload();
  }

  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <strong>path</strong> {pathname}
      </div>
      <div className={styles.row}>
        <strong>sheets</strong> {stack.map((s) => s.name).join(", ") || "(none)"}
      </div>
      <div className={styles.row}>
        <strong>clock offset</strong> {offset}ms
      </div>
      <div className={styles.row}>
        <strong>flow</strong> {state.flow ? `${state.flow.kind} / ${state.flow.step}` : "(none)"}
      </div>
      <div className={styles.row}>
        <strong>excludedFaces</strong> {excluded.join(", ") || "(none)"}
      </div>
      <div className={styles.section}>ledger</div>
      <pre className={styles.pre}>{JSON.stringify(state.ledger, null, 2)}</pre>
      <div className={styles.section}>companions</div>
      {state.companions.map((c) => (
        <div key={c.id} className={styles.companion}>
          <div>
            {c.templateId} · {c.status} · exchanges {c.exchanges} · unread {c.unread} · purgeAt {c.purgeAt ?? "-"}
          </div>
          <div>
            core primary {c.core.primary ?? "-"} secondary {c.core.secondary ?? "-"} weight {c.core.weight ?? "-"}
          </div>
          <div className={styles.ranked}>
            {c.core.ranked.map((r) => (
              <span key={r.id}>
                {r.id} {r.score.toFixed(4)}
              </span>
            ))}
          </div>
        </div>
      ))}
      <div className={styles.section}>actions</div>
      <div className={styles.actions}>
        <button onClick={seedCompanion}>Seed companion</button>
        <button onClick={() => dispatch({ type: "DEBUG_FREE_LEFT", n: 1 })}>Free left → 1</button>
        <button onClick={() => dispatch({ type: "DEBUG_FREE_LEFT", n: 0 })}>Free left → 0</button>
        <button onClick={() => dispatch({ type: "DEBUG_START_PASS", now: nowMs })}>Start pass</button>
        <button onClick={() => dispatch({ type: "DEBUG_PASS_USED", n: 1999 })}>Pass used → 1999</button>
        <button onClick={() => applyClockOffset(86400000)}>Clock +1 day</button>
        <button onClick={() => applyClockOffset(31 * 86400000)}>Clock +31 days</button>
        <button onClick={() => dispatch({ type: "DEBUG_PART_ALL", now: nowMs })}>Part all</button>
        <button onClick={resetSession}>Reset session</button>
        <button onClick={copyState}>Copy state as JSON</button>
      </div>
      <button className={styles.close} onClick={() => setOpen(false)} aria-label="Close debug panel">
        ×
      </button>
    </div>
  );
}
