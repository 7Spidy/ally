"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { useToast } from "@/state/useToast";
import { ManifestGate } from "@/components/ManifestGate";
import { createCompanion, rpcErrorMessage } from "@/lib/supabase/queries";
import type { Gender } from "@/state/schema";
import styles from "./page.module.css";

const REDUCED_MOTION_MIN_HOLD_MS = 1600;

/**
 * Interpretation note (spec §15 item 6): §8.1's prose ("proposal → confirm
 * (sheet) → reveal", then "on confirm, create a Companion ... and
 * router.replace('/chat/'+id)") reads as contradictory about whether
 * `CONFIRM_LOCK` fires from the confirm sheet or after reveal — but §4's
 * route list puts `reveal` after `proposal`/before chat is ever mentioned,
 * and reveal is explicitly "the one orchestrated motion moment" that must
 * play before chat. Resolved here as: ConfirmSheet's "Yes, it's them"
 * only closes the sheet and routes to `/onboarding/reveal` (flow.proposed
 * is already in state, no extra plumbing needed); THIS screen dispatches
 * `CONFIRM_LOCK` and `router.replace('/chat/'+id)` once its video ends
 * (or immediately, on a minimum hold, under reduced motion). This keeps
 * the reveal video from ever playing over an already-created chat.
 */
export default function RevealPage() {
  return (
    <ManifestGate>
      <RevealScreen />
    </ManifestGate>
  );
}

function RevealScreen() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const { templates } = useManifest();
  const showToast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(!state.user.soundOn);
  const [playing, setPlaying] = useState(false);
  const done = useRef(false);
  const canLeave = useRef(true);

  const flow = state.flow;
  const template = flow?.proposed ? templates.find((t) => t.id === flow.proposed) : undefined;

  // P2: the companion is created server-side in one call (spec D5); the chat
  // route uses the id create_companion generated. On failure the user stays
  // here and can tap again.
  const leave = async () => {
    if (done.current || !flow?.proposed || !canLeave.current) return;
    done.current = true;
    try {
      const companion = await createCompanion({
        templateId: flow.proposed,
        deckGender: flow.deckGender as Gender,
        answers: flow.answers,
        core: flow.core,
        displayName: flow.displayName,
      });
      dispatch({ type: "CONFIRM_LOCK", companion });
      router.replace("/chat/" + companion.id);
    } catch (e) {
      done.current = false;
      showToast(rpcErrorMessage(e));
    }
  };

  useEffect(() => {
    done.current = false;
    if (!template) return;
    const video = videoRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Reduced motion still plays the video (spec is explicit it's content,
    // not decoration) but holds a minimum time before a tap or `ended` can
    // advance, so a near-instant clip can't skip the moment entirely.
    canLeave.current = !reducedMotion;
    const holdTimer = reducedMotion
      ? setTimeout(() => {
          canLeave.current = true;
        }, REDUCED_MOTION_MIN_HOLD_MS)
      : null;
    if (video) {
      video.muted = muted;
      video.currentTime = 0;
      video.src = "/" + template.video;
      video.load();
      video.play().then(() => setPlaying(true)).catch(() => {
        video.muted = true;
        setMuted(true);
        video.play().then(() => setPlaying(true)).catch(() => {});
      });
    }
    return () => {
      if (holdTimer) clearTimeout(holdTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  if (!flow || !template) return null;

  return (
    <div
      className={styles.wrap}
      style={{ ["--k" as string]: template.palette }}
      onClick={(e) => {
        if ((e.target as Element).closest("button")) return;
        void leave();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void leave();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="Continue"
    >
      <div className={styles.media} aria-hidden="true">
        <Image src={"/" + template.reveal} alt="" fill sizes="390px" className={styles.still} style={{ objectFit: "cover" }} priority />
        <video ref={videoRef} playsInline className={`${styles.video} ${playing ? styles.playing : ""}`} onEnded={() => void leave()} />
      </div>
      <div className={styles.scrim} />
      <button
        type="button"
        className="icon-btn"
        style={{ position: "absolute", top: "calc(20px + var(--safe-t))", right: 12, zIndex: 2 }}
        aria-pressed={!muted}
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={(e) => {
          e.stopPropagation();
          const v = videoRef.current;
          const next = !muted;
          setMuted(next);
          if (v) v.muted = next;
        }}
      >
        <SoundIcon on={!muted} />
      </button>
      <div className={styles.text}>
        <h1 className={styles.name}>{template.name}</h1>
        <p className={styles.line}>{template.read}</p>
      </div>
    </div>
  );
}

function SoundIcon({ on }: { on: boolean }) {
  return on ? (
    <svg viewBox="0 0 24 24">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 9a4 4 0 0 1 0 6" />
      <path d="M18.5 6.5a8 8 0 0 1 0 11" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 9l4 6M21 9l-4 6" />
    </svg>
  );
}
