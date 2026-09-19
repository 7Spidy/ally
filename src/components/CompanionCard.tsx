"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Companion } from "@/state/schema";
import type { Template } from "@/lib/engine";
import { PRESENCE, COPY, fill } from "@/lib/copy";
import { isDaytimeIST, now } from "@/lib/clock";
import { firstNameFromFull } from "@/lib/engine";
import styles from "./CompanionCard.module.css";

/**
 * Home carousel card for one active companion, spec §10.3. `--k` is set
 * inline to the template's own palette (a per-surface accent, not the
 * global one — spec §10.1).
 */
export function CompanionCard({ companion, template }: { companion: Companion; template: Template }) {
  const router = useRouter();
  const firstName = firstNameFromFull(template.name);
  const occupation = template.occupation.split(",")[0].toLowerCase();
  const presence = PRESENCE[template.id];
  const presenceLine = presence ? (isDaytimeIST(now()) ? presence.day : presence.night) : "";
  const lastMessage = companion.messages[companion.messages.length - 1];

  return (
    <button
      type="button"
      className={styles.card}
      style={{ ["--k" as string]: template.palette }}
      onClick={() => router.push(`/chat/${companion.id}`)}
    >
      <Image src={"/" + template.reveal} alt="" fill className={styles.image} sizes="300px" />
      <div className={styles.scrim} />
      {companion.unread > 0 && (
        <span className={styles.badge}>{fill(COPY.home.cardUnreadBadge, { n: companion.unread })}</span>
      )}
      <div className={styles.content}>
        <p className={styles.name}>{firstName}</p>
        <p className={styles.meta}>
          {template.city}, {occupation}
        </p>
        {lastMessage && <p className={styles.lastMessage}>{lastMessage.text}</p>}
        <p className={styles.presence}>{presenceLine}</p>
      </div>
    </button>
  );
}
