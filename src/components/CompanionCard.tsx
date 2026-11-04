"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Companion } from "@/state/schema";
import type { Template } from "@/lib/engine";
import { PRESENCE, COPY, fill } from "@/lib/copy";
import { isDaytimeIn, now } from "@/lib/clock";
import { PERSONA_TZ } from "@/lib/presenceTz";
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
  const presenceLine = presence ? (isDaytimeIn(now(), PERSONA_TZ[template.id]) ? presence.day : presence.night) : "";
  const visibleMessages = companion.messages.filter((m) => !m.deleted);
  const lastMessage = visibleMessages[visibleMessages.length - 1];

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
          {template.city} · {occupation}
        </p>
        {lastMessage && (
          <div className={styles.messageBubble}>
            <svg className={styles.messageIcon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            <p className={styles.lastMessage}>
              {lastMessage.who === "me" && <span className={styles.senderPrefix}>You: </span>}
              {lastMessage.text}
            </p>
          </div>
        )}
        {presenceLine && (
          <div className={styles.presenceRow}>
            <span className={styles.presenceDot} />
            <p className={styles.presence}>{presenceLine}</p>
          </div>
        )}
      </div>
    </button>
  );
}
