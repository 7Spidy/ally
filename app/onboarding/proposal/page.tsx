"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { useSheet } from "@/state/useSheet";
import { ManifestGate } from "@/components/ManifestGate";
import { firstNameFromFull } from "@/lib/engine";
import { COPY, fill } from "@/lib/copy";
import { redrawFor } from "../_lib/propose";
import styles from "./page.module.css";

export default function ProposalPage() {
  return (
    <ManifestGate>
      <ProposalScreen />
    </ManifestGate>
  );
}

function ProposalScreen() {
  const { state, dispatch } = useAlly();
  const { templates } = useManifest();
  const { openSheet } = useSheet();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [fellBack, setFellBack] = useState(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flow = state.flow;
  const template = flow?.proposed ? templates.find((t) => t.id === flow.proposed) : undefined;

  useEffect(() => {
    if (!template) return;
    setPlaying(false);
    setFellBack(false);
    const video = videoRef.current;
    if (!video) return;
    clearTimeout(fallbackTimer.current);
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      setFellBack(true);
    };
    fallbackTimer.current = setTimeout(fail, 3000);
    const onCanPlay = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer.current);
      video.play().then(() => setPlaying(true)).catch(fail);
    };
    video.addEventListener("canplay", onCanPlay, { once: true });
    video.addEventListener("error", fail, { once: true });
    video.muted = !state.user.unmuted;
    video.src = "/" + template.video;
    video.load();
    return () => {
      clearTimeout(fallbackTimer.current);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", fail);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = !state.user.unmuted;
  }, [state.user.unmuted]);

  if (!flow || !template) return null;

  const persona = firstNameFromFull(template.name);

  function onRedraw() {
    if (!flow) return;
    const result = redrawFor(flow);
    dispatch({ type: "REDRAW" });
    dispatch({ type: "PROPOSE", result });
  }

  return (
    <>
      <div className="stack">
        <div className={styles.frame} style={{ ["--k" as string]: template.palette }}>
          {/* Still frame shows first; the video crossfades in once it can play. */}
          <Image src={"/" + template.portrait} alt="" fill sizes="390px" className={`${styles.media} ${fellBack ? styles.kb : ""}`} style={{ objectFit: "cover" }} priority />
          <video ref={videoRef} playsInline className={`${styles.media} ${playing ? styles.playing : ""}`} />
          <button
            type="button"
            className="icon-btn"
            style={{ position: "absolute", right: 12, bottom: 12, zIndex: 2 }}
            aria-pressed={state.user.unmuted}
            aria-label={state.user.unmuted ? "Mute" : "Unmute"}
            onClick={() => dispatch({ type: "SET_UNMUTED", unmuted: !state.user.unmuted })}
          >
            <SoundIcon on={state.user.unmuted} />
          </button>
        </div>
        <div>
          <h1 className="q">{fill(COPY.proposal.heading, { persona })}</h1>
          <div className={styles.meta}>
            <p>
              {template.age}, {template.city}
            </p>
            <p className="meta">{template.occupation}</p>
          </div>
        </div>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => openSheet("confirm")}>
          {COPY.proposal.primary}
        </button>
        {flow.canRedraw && (
          <button type="button" className="btn secondary" onClick={onRedraw}>
            {COPY.proposal.secondary}
          </button>
        )}
      </div>
    </>
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
