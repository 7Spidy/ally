"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useAuth } from "@/state/useAuth";
import { now } from "@/lib/clock";
import { SPLASH_RETURN_MS } from "@/lib/config";
import { isBlocked, wipeLegacy } from "@/lib/migrate";
import { bootTarget } from "@/lib/boot";
import { RippleSplash } from "@/components/firstRun/RippleSplash";
import styles from "./page.module.css";

const STEP_TO_PATH: Record<string, string> = {
  consent: "/onboarding/consent",
  location: "/onboarding/location",
  gender: "/onboarding/gender",
  name: "/onboarding/name",
  birthday: "/onboarding/birthday",
  "questions/disclosure": "/onboarding/questions/disclosure",
  "questions/warmth": "/onboarding/questions/warmth",
  "questions/push": "/onboarding/questions/push",
  "questions/structure": "/onboarding/questions/structure",
  "questions/nostalgia": "/onboarding/questions/nostalgia",
  "questions/pressure": "/onboarding/questions/pressure",
  "questions/interests": "/onboarding/questions/interests",
  matching: "/onboarding/matching",
  deck: "/onboarding/deck",
  choosing: "/onboarding/choosing",
  proposal: "/onboarding/proposal",
  reveal: "/onboarding/reveal",
};

/** Boot decision, spec §4.2. Runs once on mount, after AllyProvider's migrate(). */
export default function BootPage() {
  const router = useRouter();
  const { state, dispatch, ready } = useAlly();
  const auth = useAuth();
  const [phase, setPhase] = useState<"deciding" | "first-splash" | "first-choose" | "returning-splash">("deciding");
  const ran = useRef(false);

  useEffect(() => {
    // Wait for AllyProvider's post-mount hydration: this effect (a
    // descendant's) would otherwise fire before AllyProvider's own mount
    // effect and read the SSR-safe placeholder — always a fresh,
    // companion-less state — making a one-shot decision from stale data.
    if (!ready || ran.current) return;
    ran.current = true;

    // Discard a stale round-two flow before applying the boot table.
    if (state.flow && state.flow.kind === "round2") {
      dispatch({ type: "LEAVE_ROUND2" });
    }

    // P1 (spec D12): the un-namespaced legacy `ally_v2` key is deleted once, on
    // first boot of this build. No import, and only that exact key.
    try {
      wipeLegacy(window.localStorage);
    } catch {
      /* storage blocked */
    }

    const decision = bootTarget(state, isBlocked(window.localStorage, now()), !!auth.user, now());

    if (decision.phase === "blocked") {
      router.replace("/blocked");
      return;
    }

    if (decision.phase === "first-splash") {
      if (decision.step === "consent" && state.flow?.step !== "consent") {
        // Beyond 30 days: discard silently, reset the flow before landing
        // at consent (not just visually — the stale answers/progress
        // shouldn't linger in state either).
        dispatch({ type: "RESET_FIRST_RUN_FLOW" });
      }
      setPhase("first-splash");
      return;
    }

    if (decision.phase === "first-choose") {
      setPhase("first-choose");
      return;
    }

    setPhase("returning-splash");
    const t = setTimeout(() => router.replace(decision.target), SPLASH_RETURN_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (phase === "returning-splash") {
    return (
      <div className={styles.returning}>
        <Image src="/assets/logo/ally-logo.png" alt="" width={120} height={120} className={styles.logoLarge} priority />
        <p className={`wordmark ${styles.wordmark}`}>Ally</p>
        <p className={`meta ${styles.footer}`}>Ally is an AI. Every character here is fictional.</p>
      </div>
    );
  }

  if (phase === "first-choose") {
    const step = state.flow?.step ?? "consent";
    const path = STEP_TO_PATH[step] ?? "/onboarding/consent";
    return (
      <FirstRunChoice
        onContinue={() => router.replace(path)}
        onStartOver={() => {
          dispatch({ type: "RESET_FIRST_RUN_FLOW" });
          router.replace("/onboarding/consent");
        }}
      />
    );
  }

  if (phase === "first-splash") {
    const step = state.flow?.step ?? "consent";
    const path = STEP_TO_PATH[step] ?? "/onboarding/consent";
    return <FirstRunSplash onDone={() => router.replace(path)} />;
  }

  return null;
}

/**
 * 7-30 days since the user was last mid-onboarding (PRD §4.1 / spec
 * §4.2's boot table): offer continue-or-start-over rather than resuming
 * silently. Neither the v1.0 nor v3.0 spec gives exact copy for this
 * screen (it's described only as a behavior, never in a copy table) — the
 * strings below are a reasonable on-brand interpretation, not a spec
 * string, flagged as such in the report.
 */
function FirstRunChoice({ onContinue, onStartOver }: { onContinue: () => void; onStartOver: () => void }) {
  return (
    <div className={styles.splash}>
      <Image src="/assets/logo/ally-logo.png" alt="" width={64} height={64} className={styles.logoMark} priority />
      <p className={`wordmark ${styles.wordmark}`}>Ally</p>
      <h1 className={styles.headline}>Still there?</h1>
      <div className={styles.actions}>
        <button className="btn primary" onClick={onContinue}>
          Continue where I left off
        </button>
        <button className="btn secondary" onClick={onStartOver}>
          Start over
        </button>
      </div>
    </div>
  );
}

/** First-run splash: the Ripple visual layer (first-run visuals spec §4.3). */
function FirstRunSplash({ onDone }: { onDone: () => void }) {
  return <RippleSplash onDone={onDone} />;
}
