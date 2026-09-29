"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { ManifestGate } from "@/components/ManifestGate";
import type { Template } from "@/lib/engine";
import { constellationFaces, proposeFor } from "../_lib/propose";
import { Constellation } from "./Constellation";

interface Plan {
  winner: Template;
  ring: Template[];
  short: boolean;
}

/**
 * The selection moment between the deck and the proposal. On mount it works
 * out the winner exactly as before (`proposeFor`), dispatches `PROPOSE`, plays
 * the Constellation, then routes to the proposal. `?short=1` is the redraw
 * variant ("Show me someone else"). Nothing here calls an LLM.
 *
 * `proposeFor` reads only stored flow state (and a PRNG seeded from it), so a
 * refresh mid-animation replays the same winner.
 */
export default function ChoosingPage() {
  return (
    <ManifestGate>
      <ChoosingScreen />
    </ManifestGate>
  );
}

function ChoosingScreen() {
  const router = useRouter();
  const { state, dispatch, ready } = useAlly();
  const { templates } = useManifest();
  const [plan, setPlan] = useState<Plan | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    // Not until the post-mount hydration has replaced the placeholder state.
    if (ran.current || !ready || !state.flow) return;
    ran.current = true;
    const flow = state.flow;
    const result = proposeFor(flow);
    dispatch({ type: "PROPOSE", result });
    const byId = new Map(templates.map((t) => [t.id, t]));
    const winner = result.proposed ? byId.get(result.proposed) : undefined;
    if (!winner) {
      router.replace("/onboarding/proposal");
      return;
    }
    const short = new URLSearchParams(window.location.search).get("short") === "1";
    const ring = constellationFaces(flow, winner.id)
      .map((id) => byId.get(id))
      .filter((t): t is Template => !!t);
    setPlan({ winner, ring, short });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.flow, templates]);

  if (!plan) return null;
  return (
    <Constellation
      winner={plan.winner}
      ring={plan.ring}
      short={plan.short}
      soundOn={state.user.soundOn}
      onDone={() => router.replace("/onboarding/proposal")}
    />
  );
}
