"use client";

import { useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { ManifestGate } from "@/components/ManifestGate";
import { pool } from "@/lib/selectors";
import { genderPanelInert } from "@/lib/addCard";
import { COPY } from "@/lib/copy";
import type { Gender } from "@/state/schema";
import { invalidationFor } from "../_lib/invalidate";
import { useOnboardingToast } from "../_lib/Toast";
import { ChoiceRivers } from "@/components/firstRun/ChoiceRivers";

export default function GenderPage() {
  return (
    <ManifestGate>
      <GenderScreen />
    </ManifestGate>
  );
}

function GenderScreen() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const { templates } = useManifest();
  const toast = useOnboardingToast();
  const committing = useRef(false);

  const isRound2 = state.flow?.kind === "round2";
  const womanIds = useMemo(() => pool(state, templates, "woman").map((t) => t.id), [state, templates]);
  const manIds = useMemo(() => pool(state, templates, "man").map((t) => t.id), [state, templates]);
  const womanDisabled = genderPanelInert(isRound2, womanIds.length);
  const manDisabled = genderPanelInert(isRound2, manIds.length);
  const disabled = useMemo(() => ({ woman: womanDisabled, man: manDisabled }), [womanDisabled, manDisabled]);

  if (!state.flow) return null;

  /** The existing choose(g) body, run at commit start. Routing is ChoiceRivers' onRoute. */
  function choose(g: Gender): boolean {
    if (!state.flow || committing.current) return false;
    if (genderPanelInert(isRound2, g === "woman" ? womanIds.length : manIds.length)) return false;
    committing.current = true;
    if (g !== state.flow.deckGender) {
      const { patch, changed } = invalidationFor("gender", state.flow);
      if (changed && patch) {
        dispatch({ type: "INVALIDATE", patch });
        toast(COPY.recompute.toast);
      }
    }
    dispatch({ type: "SET_GENDER", gender: g });
    return true;
  }

  return (
    <ChoiceRivers
      womanIds={womanIds}
      manIds={manIds}
      disabled={disabled}
      selected={state.flow.deckGender ?? null}
      isRound2={isRound2}
      onCommit={choose}
      onRoute={() => router.push(isRound2 ? "/onboarding/questions/disclosure" : "/onboarding/name")}
    />
  );
}
