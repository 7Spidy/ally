"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Message } from "@/state/schema";
import { COPY, fill } from "@/lib/copy";
import { isFresh, receiptFor } from "@/lib/chatActions";
import { differentDay, dayLabel, timeLabel } from "@/lib/chatDates";
import { now } from "@/lib/clock";
import { Bubble, type BubbleQuote } from "@/components/chat/Bubble";
import { TypingDots } from "@/components/chat/TypingDots";
import { JumpToLatest } from "@/components/chat/JumpToLatest";
import styles from "./MessageList.module.css";

/** Within this many px of the bottom the list follows new messages. */
const STICK_PX = 120;
/** Further than this from the bottom the jump-to-latest button shows. */
const JUMP_PX = 300;

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
 *
 * U1: only the newest messages are loaded; scrolling to the top pages in older
 * ones without moving what you are reading. The list follows new messages only
 * while you are near the bottom (or when the new one is yours), shows a date
 * separator between days, and a tap on a bubble shows its time.
 */
export function MessageList({
  messages,
  dividerBeforeAt,
  typing,
  readUpTo,
  companionColor,
  personaName,
  footer,
  onRetry,
  onOpenActions,
  onReply,
  hasMore = false,
  loadingOlder = false,
  onLoadOlder,
  jumpTarget = null,
  onQuoteJump,
}: {
  messages: Message[];
  dividerBeforeAt: number | null;
  typing: boolean;
  /** The id of the newest message she has read; drives Delivered and Read. */
  readUpTo: number | null;
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
  /** Older messages exist on the server. */
  hasMore?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  /** Scroll to this message and flash it. A new `nonce` repeats the jump to the same id. */
  jumpTarget?: { id: number; nonce: number } | null;
  /** A quote was tapped. The page loads older pages if the original is not here yet, then sets jumpTarget. */
  onQuoteJump?: (id: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [timeFor, setTimeFor] = useState<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [newBelow, setNewBelow] = useState(false);

  // Whatever is here at first render is history; anything added afterwards arrived live and plays its entrance.
  const initialIds = useRef<Set<number> | null>(null);
  if (initialIds.current === null) {
    initialIds.current = new Set(messages.flatMap((m) => (typeof m.id === "number" ? [m.id] : [])));
  }

  const keyOf = (m: Message, i: number) => m.clientKey ?? m.id ?? `i${i}`;
  const nearBottomRef = useRef(true);
  const prevRef = useRef<{ first: string | number; last: string | number; len: number; height: number } | null>(null);
  const prevLoadingRef = useRef(false);

  // Scroll bookkeeping after every render: keep the reader's place when older
  // messages are prepended, follow new messages only near the bottom or when
  // the newest is the user's own, otherwise remember something arrived below.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const first = messages.length ? keyOf(messages[0], 0) : "";
    const lastIndex = messages.length - 1;
    const last = lastIndex >= 0 ? keyOf(messages[lastIndex], lastIndex) : "";
    const prev = prevRef.current;
    const lastMsg = messages[lastIndex];
    const appended = prev !== null && prev.last !== last;
    const loadingFlipped = prevLoadingRef.current !== loadingOlder;
    prevLoadingRef.current = loadingOlder;
    if (!prev) {
      el.scrollTop = el.scrollHeight;
    } else if (prev.first !== first && !appended && messages.length > prev.len) {
      // Older messages were added above: hold the view where it was.
      el.scrollTop += el.scrollHeight - prev.height;
    } else if (nearBottomRef.current || (appended && lastMsg?.who === "me")) {
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
    } else if (loadingFlipped && !appended) {
      // The loader row came or went above what is on screen: hold the view.
      el.scrollTop += el.scrollHeight - prev.height;
    } else if (appended) {
      setNewBelow(true);
    }
    prevRef.current = { first, last, len: messages.length, height: el.scrollHeight };
  }, [messages, typing, footer, onRetry, loadingOlder]);

  // The list shrinks when a card or the keyboard appears above or below it: stay on the newest message if that is where you were.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (nearBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const away = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = away <= STICK_PX;
    setShowJump(away > JUMP_PX);
    if (away <= STICK_PX) setNewBelow(false);
  }

  function toLatest() {
    const el = listRef.current;
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
    setNewBelow(false);
    // A smooth scroll can stop short when the list re-renders under it: land exactly on the newest message.
    setTimeout(() => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 2) el.scrollTop = el.scrollHeight;
    }, reduce ? 0 : 500);
  }

  // Load the previous page when the sentinel at the top comes into view.
  useEffect(() => {
    const top = topRef.current;
    const root = listRef.current;
    if (!hasMore || loadingOlder || !top || !root || !onLoadOlder || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadOlder();
      },
      { root, rootMargin: "160px 0px 0px 0px" }
    );
    io.observe(top);
    return () => io.disconnect();
  }, [hasMore, loadingOlder, onLoadOlder, messages.length]);

  // A jump asked for by the page (a quote, a pinned message).
  const jumpId = jumpTarget?.id ?? null;
  const jumpNonce = jumpTarget?.nonce ?? 0;
  useEffect(() => {
    if (jumpId === null) return;
    const el = document.getElementById(`m-${jumpId}`);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    setFlashId(jumpId);
  }, [jumpId, jumpNonce]);

  useEffect(() => {
    if (flashId === null) return;
    const t = setTimeout(() => setFlashId(null), 1300);
    return () => clearTimeout(t);
  }, [flashId]);

  function tap(m: Message) {
    if (typeof m.id !== "number") return;
    setTimeFor((cur) => (cur === m.id ? null : (m.id as number)));
  }

  let dividerShown = false;
  const color = companionColor ?? "var(--k)";
  const receipt = receiptFor(messages, readUpTo);
  const nowMs = now();

  return (
    <div className={styles.wrap}>
      <div className={styles.list} ref={listRef} onScroll={onScroll} data-testid="message-list">
        <div ref={topRef} className={styles.top} aria-hidden />
        {loadingOlder && (
          <div className={styles.older} role="status" data-testid="loading-older">
            {COPY.chat.loadingOlder}
          </div>
        )}
        {messages.map((m, i) => {
          const showDivider = !dividerShown && dividerBeforeAt !== null && m.who === "them" && m.at > dividerBeforeAt;
          if (showDivider) dividerShown = true;
          const showDate = i === 0 || differentDay(messages[i - 1].at, m.at);
          const qid = m.meta?.quoteId;
          const original = qid !== undefined ? messages.find((x) => x.id === qid) : undefined;
          const quote: BubbleQuote | null = original
            ? { id: original.id as number, label: original.who === "me" ? COPY.chat.quoteYou : personaName ?? "", text: original.text, deleted: original.deleted === true }
            : qid !== undefined && hasMore && !m.deleted
              ? { id: qid, label: "", text: COPY.chat.quoteEarlier, deleted: false }
              : null;
          return (
            <div key={keyOf(m, i)} className={m.who === "me" ? styles.rowMe : styles.rowThem}>
              {showDate && (
                <div className={styles.dateSep} data-testid="date-sep">
                  {dayLabel(m.at, nowMs)}
                </div>
              )}
              {showDivider && <div className={styles.divider}>{COPY.chat.sinceYouLeft}</div>}
              <Bubble
                m={m}
                quote={quote}
                color={color}
                fresh={isFresh(m, initialIds.current as Set<number>)}
                flash={flashId !== null && m.id === flashId}
                onOpenActions={(x) => onOpenActions?.(x)}
                onReply={(x) => onReply?.(x)}
                onJump={(id) => onQuoteJump?.(id)}
                onTap={tap}
              />
              {timeFor !== null && m.id === timeFor && !m.deleted && (
                <span className={m.who === "me" ? styles.stampMe : styles.stampThem} data-testid="bubble-time">
                  {timeLabel(m.at)}
                </span>
              )}
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
      </div>
      <JumpToLatest visible={showJump} unseen={newBelow} onClick={toLatest} />
    </div>
  );
}
