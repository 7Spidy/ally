"use client";

import { useEffect, useRef } from "react";
import type { Message } from "@/state/schema";
import { COPY } from "@/lib/copy";
import styles from "./MessageList.module.css";

/**
 * The `Since you left` divider precedes the first `them` message whose
 * `at` is later than `dividerBeforeAt` (spec §10.4) — the previous
 * `lastOpenedAt`, captured by the caller before OPEN_CHAT overwrites it.
 */
export function MessageList({
  messages,
  dividerBeforeAt,
  typing,
}: {
  messages: Message[];
  dividerBeforeAt: number | null;
  typing: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, typing]);

  let dividerShown = false;

  return (
    <div className={styles.list}>
      {messages.map((m, i) => {
        const showDivider =
          !dividerShown && dividerBeforeAt !== null && m.who === "them" && m.at > dividerBeforeAt;
        if (showDivider) dividerShown = true;
        return (
          <div key={i}>
            {showDivider && <div className={styles.divider}>{COPY.chat.sinceYouLeft}</div>}
            <p className={`${styles.bubble} ${m.who === "me" ? styles.me : styles.them}`}>{m.text}</p>
          </div>
        );
      })}
      {typing && <p className={styles.typing}>…</p>}
      <div ref={endRef} />
    </div>
  );
}
