"use client";

import { useEffect, useRef, useState } from "react";
import { COPY, fill } from "@/lib/copy";
import styles from "./Composer.module.css";

export type ComposerVariant = "normal" | "oneLeft" | "empty" | "capped";

/**
 * Chat composer, gated per spec §11's ledger table. `capped` replaces the
 * composer outright; `empty` keeps the input visually present but any tap
 * on it opens the paywall instead of focusing; `oneLeft` is the normal
 * composer with a warning bar above it.
 */
export function Composer({
  variant: baseVariant,
  persona,
  onSend,
  onOpenPaywall,
  replyingTo,
  onCancelReply,
  editing,
  onSaveEdit,
  onCancelEdit,
}: {
  variant: ComposerVariant;
  persona: string;
  onSend: (text: string) => void;
  onOpenPaywall: () => void;
  /** B3: a quote chip above the input while a reply is being written. */
  replyingTo?: { label: string; text: string } | null;
  onCancelReply?: () => void;
  /** B3: editing one of your own messages. Free, so it ignores the message limits. */
  editing?: { id: number; text: string } | null;
  onSaveEdit?: (text: string) => void;
  onCancelEdit?: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const variant: ComposerVariant = editing ? "normal" : baseVariant;

  // Entering edit mode loads the message; leaving it clears the box.
  const editingId = editing?.id ?? null;
  const editingText = editing?.text ?? "";
  useEffect(() => {
    if (editingId === null) return;
    setText(editingText);
    inputRef.current?.focus();
  }, [editingId, editingText]);

  const replyKey = replyingTo ? `${replyingTo.label}:${replyingTo.text}` : "";
  useEffect(() => {
    if (replyKey) inputRef.current?.focus();
  }, [replyKey]);

  if (variant === "capped") {
    return (
      <div className={styles.wrap}>
        <p className={styles.done}>{fill(COPY.chat.barPassCappedDone, { persona })}</p>
      </div>
    );
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (editing) {
      onSaveEdit?.(trimmed);
      setText("");
      return;
    }
    onSend(trimmed);
    setText("");
  }

  return (
    <div className={styles.wrap}>
      {variant === "oneLeft" && (
        <div className={styles.bar}>
          <span>{COPY.chat.barOneLeft}</span>
          <button type="button" className={styles.barAction} onClick={onOpenPaywall}>
            {COPY.chat.barGetPass}
          </button>
        </div>
      )}
      {variant === "empty" && (
        <div className={styles.bar}>
          <span>{COPY.chat.barZeroLeft}</span>
          <button type="button" className={styles.barAction} onClick={onOpenPaywall}>
            {COPY.chat.barGetPass}
          </button>
        </div>
      )}
      {editing && (
        <div className={styles.context} data-testid="edit-bar">
          <span className={styles.contextText}>
            <span className={styles.contextLabel}>{COPY.chat.editing}</span>
          </span>
          <button
            type="button"
            className={styles.contextClose}
            aria-label={COPY.chat.cancel}
            onClick={() => {
              setText("");
              onCancelEdit?.();
            }}
          >
            ×
          </button>
        </div>
      )}
      {!editing && replyingTo && (
        <div className={styles.context} data-testid="reply-bar">
          <span className={styles.contextText}>
            <span className={styles.contextLabel}>{fill(COPY.chat.replyingTo, { name: replyingTo.label })}</span>
            <span className={styles.contextBody}>{replyingTo.text}</span>
          </span>
          <button type="button" className={styles.contextClose} aria-label={COPY.chat.cancel} onClick={onCancelReply}>
            ×
          </button>
        </div>
      )}
      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault();
          if (variant === "empty") {
            onOpenPaywall();
            return;
          }
          submit();
        }}
      >
        <input
          ref={inputRef}
          className={styles.input}
          value={text}
          placeholder="Message"
          aria-label="Message"
          readOnly={variant === "empty"}
          onFocus={() => {
            if (variant === "empty") onOpenPaywall();
          }}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          className={styles.send}
          aria-label={editing ? COPY.chat.save : "Send"}
          disabled={variant !== "empty" && !text.trim()}
        >
          <svg viewBox="0 0 24 24">{editing ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M12 19V5M5 12l7-7 7 7" />}</svg>
        </button>
      </form>
    </div>
  );
}
