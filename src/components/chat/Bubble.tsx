"use client";

import { useEffect } from "react";
import type { Message } from "@/state/schema";
import { COPY } from "@/lib/copy";
import { isJumboEmoji } from "@/lib/emoji";
import { canReply } from "@/lib/chatActions";
import { BEAT_BUZZ, vibrate } from "@/lib/vibrate";
import { ReactionPill } from "@/components/chat/ReactionPill";
import { QuoteBlock } from "@/components/chat/QuoteBlock";
import { InkText } from "@/components/chat/InkText";
import { useBubbleGestures } from "@/components/chat/useBubbleGestures";
import styles from "@/components/MessageList.module.css";

export interface BubbleQuote {
  label: string;
  text: string;
  deleted: boolean;
  id: number;
}

const EFFECT_CLASS: Record<string, string> = {
  soft: styles.soft,
  loud: styles.loud,
  pin: styles.pin,
  shake: styles.shake,
  sparkle: styles.sparkle,
  echo: styles.echo,
  bloom: styles.bloom,
  heartbeat: styles.heartbeat,
};

/**
 * One message. Her effects are a look (a class) plus, for a bubble that
 * arrived while the chat was open, an entrance (`data-fresh`), so an old
 * message never replays its animation when the page is reopened.
 */
export function Bubble({
  m,
  quote,
  color,
  fresh,
  flash,
  onOpenActions,
  onReply,
  onJump,
}: {
  m: Message;
  quote: BubbleQuote | null;
  /** The companion's palette hex, for pin rings and quote borders. */
  color: string;
  fresh: boolean;
  flash: boolean;
  onOpenActions: (m: Message) => void;
  onReply: (m: Message) => void;
  onJump: (id: number) => void;
}) {
  const mine = m.who === "me";
  const effect = !mine ? m.meta?.effect : undefined;
  const tomb = m.deleted === true;
  const actionable = !tomb && canReply(m);

  const { rowRef, bind } = useBubbleGestures({
    enabled: actionable,
    direction: mine ? -1 : 1,
    onOpenActions: () => onOpenActions(m),
    onSwipeReply: () => onReply(m),
  });

  // A heartbeat that arrives live also taps the phone, twice.
  useEffect(() => {
    if (fresh && effect === "heartbeat") vibrate(BEAT_BUZZ);
  }, [fresh, effect]);

  const jumbo = !tomb && !effect && !quote && isJumboEmoji(m.text);
  const cls = [
    styles.bubble,
    mine ? styles.me : styles.them,
    tomb ? styles.tomb : "",
    jumbo ? styles.jumbo : "",
    effect ? EFFECT_CLASS[effect] ?? "" : "",
  ].join(" ");

  return (
    <div ref={rowRef} className={styles.swipeRow} id={m.id !== undefined ? `m-${m.id}` : undefined} data-mine={mine ? "true" : "false"}>
      {actionable && (
        <span className={styles.replyHint} aria-hidden>
          <svg viewBox="0 0 24 24">
            <path d="M10 8V5l-7 7 7 7v-3c5 0 8 1 11 5-1-6-4-11-11-13z" />
          </svg>
        </span>
      )}
      <div
        className={cls}
        style={effect === "pin" ? { boxShadow: `0 0 0 1.5px ${color}` } : undefined}
        data-effect={effect ?? undefined}
        data-fresh={fresh ? "true" : undefined}
        data-flash={flash ? "true" : undefined}
        data-testid={tomb ? "bubble-deleted" : undefined}
        tabIndex={actionable ? 0 : undefined}
        aria-haspopup={actionable ? "menu" : undefined}
        {...bind}
      >
        {tomb ? (
          <span>{mine ? COPY.chat.deletedMine : COPY.chat.deletedHers}</span>
        ) : (
          <>
            {quote && <QuoteBlock label={quote.label} text={quote.text} color={color} deleted={quote.deleted} onJump={() => onJump(quote.id)} />}
            {effect === "ink" ? <InkText id={m.id} text={m.text} /> : m.text}
            {mine && m.meta?.reaction && <ReactionPill emoji={m.meta.reaction} />}
          </>
        )}
      </div>
      {!tomb && m.editedAt ? <span className={styles.editedTag}>{COPY.chat.edited}</span> : null}
    </div>
  );
}
