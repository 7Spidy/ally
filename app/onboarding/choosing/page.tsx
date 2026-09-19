"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { proposeFor } from "../_lib/propose";

/**
 * Interpretation note (spec §15 item 6): this route exists in the repo
 * layout (spec §3) but is not described anywhere else in the spec. The
 * flow narrative (§8.1, §8.2) goes straight from deck to proposal via
 * `nextProposal()`. Treated here as a non-visual computation waypoint: on
 * mount, call `nextProposal(flow)`, dispatch `PROPOSE` with the result,
 * then immediately `router.replace('/onboarding/proposal')`. It renders
 * nothing so it's never actually seen, per "do not add screens not
 * specified here".
 */
export default function ChoosingPage() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !state.flow) return;
    ran.current = true;
    const result = proposeFor(state.flow);
    dispatch({ type: "PROPOSE", result });
    router.replace("/onboarding/proposal");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.flow]);

  return null;
}
