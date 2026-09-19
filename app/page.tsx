"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { active, lastOpened } from "@/lib/selectors";
import { now } from "@/lib/clock";
import { SPLASH_RETURN_MS } from "@/lib/config";
import { isBlocked } from "@/lib/migrate";
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
  const { state, dispatch } = useAlly();
  const [phase, setPhase] = useState<"deciding" | "first-splash" | "returning-splash">("deciding");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (isBlocked(window.localStorage, now())) {
      router.replace("/blocked");
      return;
    }

    // Discard a stale round-two flow before applying the boot table.
    if (state.flow && state.flow.kind === "round2") {
      dispatch({ type: "LEAVE_ROUND2" });
    }

    const activeList = active(state);
    const hasCompanionEver = state.companions.length > 0 || state.user.accountAt !== null;

    if (!hasCompanionEver && (!state.flow || state.flow.kind === "first")) {
      setPhase("first-splash");
      return;
    }

    if (activeList.length > 0) {
      setPhase("returning-splash");
      const target = lastOpened(state);
      const t = setTimeout(() => router.replace(target ? `/chat/${target.id}` : "/home"), SPLASH_RETURN_MS);
      return () => clearTimeout(t);
    }

    setPhase("returning-splash");
    const t = setTimeout(() => router.replace("/home"), SPLASH_RETURN_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "returning-splash") {
    return (
      <div className={styles.returning}>
        <Image src="/assets/logo/ally-logo.png" alt="" width={120} height={120} className={styles.logoLarge} priority />
        <p className={`wordmark ${styles.wordmark}`}>Ally</p>
        <p className={`meta ${styles.footer}`}>Ally is an AI. Every character here is fictional.</p>
      </div>
    );
  }

  if (phase === "first-splash") {
    const step = state.flow?.step ?? "consent";
    const path = STEP_TO_PATH[step] ?? "/onboarding/consent";
    return <FirstRunSplash onDone={() => router.replace(path)} />;
  }

  return null;
}

function FirstRunSplash({ onDone }: { onDone: () => void }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
  }, []);
  return (
    <div className={styles.splash}>
      <Image src="/assets/logo/ally-logo.png" alt="" width={56} height={56} className={styles.logoMark} priority />
      <p className={`wordmark ${styles.wordmark}`}>Ally</p>
      <h1 className={styles.headline}>Someone to talk to. Not a chatbot pretending.</h1>
      <div className={styles.actions}>
        <button className="btn primary" onClick={onDone}>
          Get started
        </button>
        <p className={`meta ${styles.footer}`}>Ally is an AI. Every character here is fictional.</p>
      </div>
    </div>
  );
}
