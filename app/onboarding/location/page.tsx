"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { resolveRegion, suggestPlaces, SOMEWHERE_ELSE, PLACES } from "@/lib/engine";
import { COPY } from "@/lib/copy";
import { invalidationFor } from "../_lib/invalidate";
import { useOnboardingToast } from "../_lib/Toast";
import styles from "./page.module.css";

const CHIPS = ["Mumbai", "Delhi", "Bengaluru", "Kolkata", "Chennai", "Pune", "Hyderabad", SOMEWHERE_ELSE];

export default function LocationPage() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const toast = useOnboardingToast();
  const [value, setValue] = useState(state.flow?.cityRaw ?? "");
  // "Somewhere else" chosen: the field is free text and nothing is prefilled.
  const [elsewhere, setElsewhere] = useState(!state.flow?.cityRaw && state.flow?.region === "Unspecified");

  useEffect(() => {
    if (state.flow?.kind === "round2") router.replace("/onboarding/gender");
  }, [state.flow, router]);

  const trimmed = value.trim();
  const exact = useMemo(() => PLACES.some((p) => p.name.toLowerCase() === trimmed.toLowerCase()), [trimmed]);
  const suggestions = useMemo(() => (trimmed && !exact ? suggestPlaces(trimmed, 6) : []), [trimmed, exact]);
  const canContinue = trimmed.length > 0 || elsewhere;

  if (!state.flow || state.flow.kind === "round2") return null;

  function onContinue() {
    if (!state.flow) return;
    const raw = trimmed;
    const region = resolveRegion(raw);
    if (region !== state.flow.region) {
      const { patch, changed } = invalidationFor("location", state.flow);
      if (changed && patch) {
        dispatch({ type: "INVALIDATE", patch });
        toast(COPY.recompute.toast);
      }
    }
    dispatch({ type: "SET_LOCATION", cityRaw: raw, region });
    router.push("/onboarding/gender");
  }

  return (
    <>
      <div className="stack">
        <h1 className="q">{COPY.location.question}</h1>
        <input
          className={styles.field}
          type="text"
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          aria-label="City or country"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (e.target.value.trim()) setElsewhere(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canContinue) onContinue();
          }}
        />
        {suggestions.length > 0 && (
          <ul className={styles.suggest} role="listbox" aria-label="Suggestions">
            {suggestions.map((name) => (
              <li key={name} role="option" aria-selected={false}>
                <button type="button" onClick={() => setValue(name)}>
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.chips}>
          {CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              className={styles.chip}
              aria-pressed={c === SOMEWHERE_ELSE ? elsewhere : value === c}
              onClick={() => {
                if (c === SOMEWHERE_ELSE) {
                  setElsewhere(true);
                  setValue("");
                } else {
                  setElsewhere(false);
                  setValue(c);
                }
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" disabled={!canContinue} onClick={onContinue}>
          {COPY.consent.action}
        </button>
      </div>
    </>
  );
}
