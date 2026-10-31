"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import { useManifest } from "@/state/useManifest";
import { useCompanionPrefs } from "@/state/useCompanionPrefs";
import { ManifestGate } from "@/components/ManifestGate";
import { byId } from "@/lib/selectors";
import { COPY, fill } from "@/lib/copy";
import { formatTogetherSince, now } from "@/lib/clock";
import { firstNameFromFull } from "@/lib/engine";
import styles from "./page.module.css";

export default function ProfilePage() {
  return (
    <ManifestGate>
      <ProfileContent />
    </ManifestGate>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function ProfileContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { state } = useAlly();
  const { setNotify, setSound } = useCompanionPrefs();
  const { openSheet } = useSheet();
  const { templates } = useManifest();
  const reduced = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const companion = byId(state, id);
  const template = companion ? templates.find((t) => t.id === companion.templateId) : undefined;

  if (!companion || !template) {
    return <div style={{ padding: 24, color: "var(--mut)" }}>Not found.</div>;
  }

  const firstName = firstNameFromFull(template.name);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().then(() => setPlaying(true), () => {});
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  return (
    <div className={styles.page} style={{ ["--k" as string]: template.palette }}>
      <div className={styles.header}>
        <video
          ref={videoRef}
          className={styles.headerVideo}
          src={"/" + template.video}
          poster={"/" + template.reveal}
          muted
          loop
          autoPlay={!reduced}
          playsInline
          preload="metadata"
        />
        {reduced && (
          <button
            type="button"
            className={styles.playToggle}
            aria-label={playing ? `Pause ${firstName}` : `Play ${firstName}`}
            onClick={togglePlay}
          />
        )}
        <div className={styles.headerScrim} />
        <button
          type="button"
          className="icon-btn back"
          aria-label="Back"
          onClick={() => router.push(`/chat/${companion.id}`)}
        >
          <svg viewBox="0 0 24 24">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className={styles.headerContent}>
          <p className={styles.name}>{firstName}</p>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.row}>
          <span className={styles.rowLabel}>{COPY.profile.togetherSince}</span>
          <span className={styles.rowValue}>{formatTogetherSince(companion.createdAt, now())}</span>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>{COPY.profile.notifications}</span>
          <button
            type="button"
            className={`${styles.toggle} ${companion.notify ? styles.on : ""}`}
            role="switch"
            aria-checked={companion.notify}
            aria-label={COPY.profile.notifications}
            onClick={() => setNotify(companion.id, !companion.notify)}
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>{COPY.profile.messageSound}</span>
          <button
            type="button"
            className={`${styles.toggle} ${companion.sound ? styles.on : ""}`}
            role="switch"
            aria-checked={companion.sound}
            aria-label={COPY.profile.messageSound}
            onClick={() => setSound(companion.id, !companion.sound)}
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>

        <button
          type="button"
          className={styles.link}
          onClick={() => openSheet("part", { companionId: companion.id })}
        >
          {fill(COPY.profile.part, { persona: firstName })}
        </button>
      </div>
    </div>
  );
}
