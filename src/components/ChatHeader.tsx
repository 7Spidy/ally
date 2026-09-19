"use client";

import { useRef } from "react";
import type { Template } from "@/lib/engine";
import { Avatar } from "@/components/Avatar";
import { PRESENCE } from "@/lib/copy";
import { isDaytimeIST, now } from "@/lib/clock";
import { firstNameFromFull } from "@/lib/engine";
import { LONG_PRESS_MS } from "@/lib/config";
import styles from "./ChatHeader.module.css";

/** Chat header, spec §10.4: back, avatar+name+presence, overflow. */
export function ChatHeader({
  template,
  onBack,
  onOpenProfile,
  onLongPressAvatar,
  onOverflow,
}: {
  template: Template;
  onBack: () => void;
  onOpenProfile: () => void;
  onLongPressAvatar: () => void;
  onOverflow: () => void;
}) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  function startPress() {
    fired.current = false;
    pressTimer.current = setTimeout(() => {
      fired.current = true;
      onLongPressAvatar();
    }, LONG_PRESS_MS);
  }
  function endPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }

  const presence = PRESENCE[template.id];
  const presenceLine = presence ? (isDaytimeIST(now()) ? presence.day : presence.night) : "";

  return (
    <div className={styles.header}>
      <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}>
        <svg viewBox="0 0 24 24">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.identity}
        onClick={() => {
          if (fired.current) return; // the long-press already opened the switcher
          onOpenProfile();
        }}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
      >
        <Avatar template={template} size={42} />
        <span className={styles.textCol}>
          <p className={styles.name}>{firstNameFromFull(template.name)}</p>
          <p className={styles.presence}>{presenceLine}</p>
        </span>
      </button>
      <span className={styles.spacer} />
      <button type="button" className="icon-btn" aria-label="More" onClick={onOverflow}>
        <svg viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      </button>
    </div>
  );
}
