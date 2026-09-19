"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { ManifestGate } from "@/components/ManifestGate";
import { INTEREST_TAGS } from "@/lib/engine";
import { COPY } from "@/lib/copy";
import { QuestionTiles } from "../../_components/QuestionTiles";
import { invalidationFor } from "../../_lib/invalidate";
import { useOnboardingToast } from "../../_lib/Toast";

// Tile display order, ported from TILE_ORDER in ally-onboarding.html.
const TILE_ORDER = ["making", "screen", "systems", "outdoors", "music", "food", "movement", "people"] as const;

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

export default function InterestsPage() {
  return (
    <ManifestGate>
      <InterestsScreen />
    </ManifestGate>
  );
}

function InterestsScreen() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const { interestVocabulary } = useManifest();
  const toast = useOnboardingToast();
  const isRound2 = state.flow?.kind === "round2";

  const [picks, setPicks] = useState<string[]>(() => {
    if (state.flow?.answers.q11.length) return state.flow.answers.q11;
    if (isRound2) {
      const latest = [...state.companions].sort((a, b) => b.createdAt - a.createdAt)[0];
      if (latest) return latest.answers.q11;
    }
    return [];
  });

  // Guard: TILE_ORDER must cover every tag in INTEREST_TAGS, or a real
  // production build has drifted from the engine's vocabulary.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && !INTEREST_TAGS.every((t) => (TILE_ORDER as readonly string[]).includes(t))) {
      console.warn("QuestionTiles: TILE_ORDER is missing an INTEREST_TAGS entry");
    }
  }, []);

  if (!state.flow) return null;

  function onContinue() {
    if (!state.flow) return;
    const { patch, changed } = invalidationFor("q11", state.flow);
    const reallyChanged = changed && !sameSet(picks, state.flow.answers.q11);
    if (reallyChanged && patch) {
      dispatch({ type: "INVALIDATE", patch });
      toast(COPY.recompute.toast);
    }
    dispatch({ type: "SET_ANSWER", key: "q11", value: picks });
    router.push("/onboarding/matching");
  }

  return (
    <>
      <div className="stack">
        <h1 className="q">{COPY.q11.question}</h1>
        <p className="sub">{COPY.q11.sub}</p>
        {isRound2 && <p className="sub">{COPY.round2.subLine}</p>}
        <QuestionTiles tags={TILE_ORDER} labelFor={(tag) => interestVocabulary[tag] || tag} picks={picks} onChange={setPicks} />
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={onContinue}>
          {COPY.consent.action}
        </button>
      </div>
    </>
  );
}
