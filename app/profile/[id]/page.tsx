"use client";

import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import { useManifest } from "@/state/useManifest";
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

function ProfileContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const { openSheet } = useSheet();
  const { templates } = useManifest();

  const companion = byId(state, id);
  const template = companion ? templates.find((t) => t.id === companion.templateId) : undefined;

  if (!companion || !template) {
    return <div style={{ padding: 24, color: "var(--mut)" }}>Not found.</div>;
  }

  const firstName = firstNameFromFull(template.name);

  return (
    <div className={styles.page} style={{ ["--k" as string]: template.palette }}>
      <div className={styles.header}>
        <Image src={"/" + template.reveal} alt="" fill className={styles.headerImage} sizes="390px" />
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
            onClick={() => dispatch({ type: "SET_NOTIFY", companionId: companion.id, notify: !companion.notify })}
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
            onClick={() => dispatch({ type: "SET_SOUND", companionId: companion.id, sound: !companion.sound })}
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
