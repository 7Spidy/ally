"use client";

import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { useSheet } from "@/state/useSheet";
import { Sheet } from "@/components/Sheet";
import { firstNameFromFull } from "@/lib/engine";
import { COPY, fill } from "@/lib/copy";

/**
 * The only sheet allowed to hand off toward locking a companion (spec test
 * 19/43 checks this exact path is the only one that can). Per this work
 * area's resolved reading of §8.1 (see app/onboarding/reveal/page.tsx's
 * interpretation note): this sheet does NOT dispatch `CONFIRM_LOCK` itself
 * — it only closes and routes to `/onboarding/reveal`, which performs the
 * lock once its video finishes. `flow.proposed` is already in state, so
 * no props are needed here.
 */
export function ConfirmSheet() {
  const router = useRouter();
  const { state } = useAlly();
  const { templates } = useManifest();
  const { closeSheet, dismissForNavigation } = useSheet();

  const flow = state.flow;
  const template = flow?.proposed ? templates.find((t) => t.id === flow.proposed) : undefined;
  if (!template) return null;

  const persona = firstNameFromFull(template.name);

  function onYes() {
    // dismissForNavigation(), not closeSheet(): closeSheet()'s
    // history.back() is asynchronous and races router.replace() below,
    // reverting it (back() resolves after replace() already moved the
    // current history position, so it lands one step behind the intended
    // target). See SheetProvider.tsx's dismissForNavigation doc comment.
    dismissForNavigation();
    router.replace("/onboarding/reveal");
  }

  return (
    <Sheet labelledBy="confirm-body">
      <div className="stack">
        <p className="q" id="confirm-body" style={{ fontSize: 26 }}>
          {fill(COPY.confirm.body, { persona })}
        </p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={onYes}>
            {COPY.confirm.primary}
          </button>
          <button type="button" className="btn secondary" onClick={closeSheet}>
            {COPY.confirm.secondary}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
