"use client";

import { useEffect, useRef, useState } from "react";
import type { Message } from "@/state/schema";
import { COPY, fill } from "@/lib/copy";
import { isFresh, receiptFor } from "@/lib/chatActions";
import { Bubble, type BubbleQuote } from "@/components/chat/Bubble";
import { TypingDots } from "@/components/chat/TypingDots";
import styles from "./MessageList.module.css";

/**
 * The `Since you left` divider precedes the first `them` message whose
 * `at` is later than `dividerBeforeAt` (spec §10.4) — the previous
 * `lastOpenedAt`, captured by the caller before OPEN_CHAT overwrites it.
 *
 * B2: a message's `meta` (set by the server, never the client) renders as a
 * reaction pill, a quote block, or a bubble effect. `stop` is a timing
 * effect, played by the chat page, not a look.
 *
 * B3: each message is a <Bubble>, which carries the long-press and swipe
 * gestures. A deleted message is a tombstone; a quote points at its original
 * and jumps to it on tap; the newest user message shows Delivered or Read.
 */
export function MessageList({
  messages,
  dividerBeforeAt,
  typing,
  companionColor,
  personaName,
  footer,
  onRetry,
  onOpenActions,
  onReply,
}: {
  messages: Message[];
  dividerBeforeAt: number | null;
  typing: boolean;
  /** The companion's palette hex, for quote borders and pin rings. */
  companionColor?: string;
  /** Her first name, the label on a quote of one of her messages. */
  personaName?: string;
  /** System cards (not bubbles), such as the resource card, shown after the last message. */
  footer?: React.ReactNode;
  /** Set when the last reply failed: shows "Couldn't reach {persona}. Tap to retry." */
  onRetry?: (() => void) | null;
  onOpenActions?: (m: Message) => void;
  onReply?: (m: Message) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [flashId, setFlashId] = useState<number | null>(null);

  // Whatever is here at first render is history; anything added afterwards arrived live and plays its entrance.
  const initialIds = useRef<Set<number> | null>(null);
  if (initialIds.current === null) {
    initialIds.current = new Set(messages.flatMap((m) => (typeof m.id === "number" ? [m.id] : [])));
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, typing, footer, onRetry]);

  useEffect(() => {
    if (flashId === null) return;
    const t = setTimeout(() => setFlashId(null), 1300);
    return () => clearTimeout(t);
  }, [flashId]);

  function jump(id: number) {
    const el = document.getElementById(`m-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlashId(id);
  }

  let dividerShown = false;
  const color = companionColor ?? "var(--k)";
  const receipt = receiptFor(messages, typing);

  return (
    <div className={styles.list}>
      {messages.map((m, i) => {
        const showDivider = !dividerShown && dividerBeforeAt !== null && m.who === "them" && m.at > dividerBeforeAt;
        if (showDivider) dividerShown = true;
        const qid = m.meta?.quoteId;
        const original = qid !== undefined ? messages.find((x) => x.id === qid) : undefined;
        const quote: BubbleQuote | null = original
          ? { id: original.id as number, label: original.who === "me" ? COPY.chat.quoteYou : personaName ?? "", text: original.text, deleted: original.deleted === true }
          : null;
        return (
          <div key={m.id ?? `i${i}`} className={m.who === "me" ? styles.rowMe : styles.rowThem}>
            {showDivider && <div className={styles.divider}>{COPY.chat.sinceYouLeft}</div>}
            <Bubble
              m={m}
              quote={quote}
              color={color}
              fresh={isFresh(m, initialIds.current as Set<number>)}
              flash={flashId !== null && m.id === flashId}
              onOpenActions={(x) => onOpenActions?.(x)}
              onReply={(x) => onReply?.(x)}
              onJump={jump}
            />
            {m.meta?.effect === "pin" && m.who === "them" && !m.deleted && <span className={styles.pinned}>{fill(COPY.chat.pinned, { persona: personaName ?? "" })}</span>}
            {receipt?.index === i && (
              <span className={styles.receipt} data-testid="receipt">
                {receipt.status === "read" ? COPY.chat.read : COPY.chat.delivered}
              </span>
            )}
          </div>
        );
      })}
      {typing && <TypingDots />}
      {footer}
      {onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {fill(COPY.chat.retry, { persona: personaName ?? "" })}
        </button>
      )}
      <div ref={endRef} />
    </div>
  );
}
