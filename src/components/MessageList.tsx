"use client";

import { useEffect, useRef } from "react";
import type { Message } from "@/state/schema";
import { COPY } from "@/lib/copy";
import { ReactionPill } from "@/components/chat/ReactionPill";
import { QuoteBlock } from "@/components/chat/QuoteBlock";
import { InkText } from "@/components/chat/InkText";
import { TypingDots } from "@/components/chat/TypingDots";
import styles from "./MessageList.module.css";

/**
 * The `Since you left` divider precedes the first `them` message whose
 * `at` is later than `dividerBeforeAt` (spec §10.4) — the previous
 * `lastOpenedAt`, captured by the caller before OPEN_CHAT overwrites it.
 *
 * B2: a message's `meta` (set by the server, never the client) renders as a
 * reaction pill, a quote block, or a bubble effect (soft, loud, ink, pin).
 * `stop` is a timing effect, played by the chat page, not a look.
 */
export function MessageList({
  messages,
  dividerBeforeAt,
  typing,
  companionColor,
  footer,
  onRetry,
}: {
  messages: Message[];
  dividerBeforeAt: number | null;
  typing: boolean;
  /** The companion's palette hex, for quote borders and pin rings. */
  companionColor?: string;
  /** System cards (not bubbles), such as the resource card, shown after the last message. */
  footer?: React.ReactNode;
  /** Set when the last reply failed: shows "Couldn't reach Ira. Tap to retry." */
  onRetry?: (() => void) | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, typing, footer, onRetry]);

  let dividerShown = false;
  const color = companionColor ?? "var(--k)";

  return (
    <div className={styles.list}>
      {messages.map((m, i) => {
        const showDivider =
          !dividerShown && dividerBeforeAt !== null && m.who === "them" && m.at > dividerBeforeAt;
        if (showDivider) dividerShown = true;
        const meta = m.meta ?? {};
        const quoted = meta.quoteId !== undefined ? messages.find((x) => x.id === meta.quoteId) : undefined;
        const effect = m.who === "them" ? meta.effect : undefined;
        const cls = [
          styles.bubble,
          m.who === "me" ? styles.me : styles.them,
          effect === "soft" ? styles.soft : "",
          effect === "loud" ? styles.loud : "",
          effect === "pin" ? styles.pin : "",
        ].join(" ");
        return (
          <div key={m.id ?? `i${i}`} className={m.who === "me" ? styles.rowMe : styles.rowThem}>
            {showDivider && <div className={styles.divider}>{COPY.chat.sinceYouLeft}</div>}
            <div className={cls} style={effect === "pin" ? { boxShadow: `0 0 0 1.5px ${color}` } : undefined} data-effect={effect ?? undefined}>
              {quoted && <QuoteBlock text={quoted.text} color={color} />}
              {effect === "ink" ? <InkText id={m.id} text={m.text} /> : m.text}
              {m.who === "me" && meta.reaction && <ReactionPill emoji={meta.reaction} />}
            </div>
            {effect === "pin" && <span className={styles.pinned}>{COPY.chat.pinned}</span>}
          </div>
        );
      })}
      {typing && <TypingDots />}
      {footer}
      {onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {COPY.chat.retry}
        </button>
      )}
      <div ref={endRef} />
    </div>
  );
}
