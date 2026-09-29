"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { ManifestGate } from "@/components/ManifestGate";
import { excludedFaces } from "@/lib/selectors";
import { COPY, fill } from "@/lib/copy";
import type { AllyState } from "@/state/schema";
import { deckFor } from "../_lib/propose";
import styles from "./page.module.css";

/**
 * The matching moment. No forbidden words (analysing/calculating/thinking/
 * processing/matching), no percentage or scanning/radar animation. Holds
 * exactly 2500ms, not skippable. Under `prefers-reduced-motion`, no
 * fragment animation — a static frame for the same 2500ms, then resolve.
 */
export default function MatchingPage() {
  return (
    <ManifestGate>
      <MatchingScreen />
    </ManifestGate>
  );
}

function fragmentPool(state: AllyState, interestVocabulary: Record<string, string>) {
  if (!state.flow) return [];
  const a = state.flow.answers;
  const out: string[] = [];
  if (state.flow.cityRaw) out.push(state.flow.cityRaw);
  for (const q of ["q5", "q6", "q7", "q8", "q9"] as const) {
    const pick = a[q];
    if (pick != null) out.push(COPY[q].options[pick]);
  }
  if (a.q10) {
    const i = ["money", "health", "head", "alone", "notgood", "change"].indexOf(a.q10);
    if (i >= 0) out.push(COPY.q10.stops[i]);
  }
  a.q11.forEach((tag) => out.push(interestVocabulary[tag] || tag));
  return out.filter(Boolean);
}

function pickN<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

function MatchingScreen() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const { templates, interestVocabulary } = useManifest();
  const [resolved, setResolved] = useState(false);
  const ran = useRef(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  // One-time setup (core + deck order). Deliberately depends on
  // [state.flow, templates] to wait for the manifest to finish loading,
  // but its own dispatches below create a *new* state.flow reference on
  // every call — which would re-trigger this same effect and, if the
  // 2500ms resolve timer lived here too, cancel it via cleanup before it
  // ever fires (a stuck matching screen). So the timer lives in its own
  // effect below, with an empty dependency array, unaffected by state
  // changes.
  useEffect(() => {
    if (ran.current || !state.flow) return;
    ran.current = true;
    dispatch({ type: "COMPUTE_CORE" });
    if (state.flow.deckOrder.length === 0 && state.flow.deckGender) {
      dispatch({ type: "DECK_INIT", deckOrder: deckFor(state.flow, templates, excludedFaces(state)) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.flow, templates]);

  useEffect(() => {
    const t = setTimeout(() => setResolved(true), 2500);
    return () => clearTimeout(t);
  }, []);

  if (!state.flow) return null;

  const fragments = reducedMotion ? [] : pickN(fragmentPool(state, interestVocabulary), 8);

  return (
    <div className={styles.wrap} aria-live="polite">
      {!resolved && !reducedMotion && (
        <div className={styles.frags} aria-hidden="true">
          {fragments.map((text, i) => (
            <span
              key={i}
              className={styles.frag}
              style={{
                left: `${8 + Math.random() * 50}%`,
                top: `${14 + Math.random() * 62}%`,
                animationDelay: `${i * 160}ms`,
              }}
            >
              {text}
            </span>
          ))}
        </div>
      )}
      {resolved && (
        <div className="stack">
          <h1 className="q">{fill(COPY.matching.resolve, { name: state.flow.displayName })}</h1>
          <p className="sub">{COPY.matching.sub}</p>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => router.push("/onboarding/deck")}>
              {COPY.matching.action}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
