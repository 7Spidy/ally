"use client";

import { useEffect, useRef, useState } from "react";
import { COPY, fill } from "@/lib/copy";
import type { ComposerGate } from "@/lib/entitlement";
import styles from "./Composer.module.css";

export type ComposerVariant = ComposerGate;

/** Which plans-screen entry point a composer bar leads to. */
export type PlansFrom = "chats" | "locked" | "newally";

/**
 * Chat composer, gated by the user's plan (see composerGate in lib/entitlement).
 *  - `trialLimit`, `expired` and `locked` replace the composer with a bar that opens
 *    the plans screen (from=chats, locked, newally).
 *  - `fairUse` replaces it with a plain notice: no counter, no upsell.
 *  - `oneLeft` is the normal composer with a warning bar above it.
 */
export function Composer({
  variant: baseVariant,
  onSend,
  onOpenPlans,
  replyingTo,
  onCancelReply,
  editing,
  onSaveEdit,
  onCancelEdit,
}: {
  variant: ComposerVariant;
  onSend: (text: string) => void;
  onOpenPlans: (from: PlansFrom) => void;
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

  if (variant === "fairUse") {
    return (
      <div className={styles.wrap}>
        <p className={styles.done} role="status">
          {COPY.chat.barFairUse}
        </p>
      </div>
    );
  }

  if (variant === "trialLimit" || variant === "expired" || variant === "locked") {
    const text = variant === "trialLimit" ? COPY.chat.barTrialLimit : variant === "expired" ? COPY.chat.barExpired : COPY.chat.barLocked;
    const from: PlansFrom = variant === "trialLimit" ? "chats" : variant === "expired" ? "locked" : "newally";
    return (
      <div className={styles.wrap}>
        <button type="button" className={styles.planBar} data-testid={`composer-${variant}`} onClick={() => onOpenPlans(from)}>
          {text}
        </button>
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
          <button type="button" className={styles.barAction} onClick={() => onOpenPlans("chats")}>
            {COPY.chat.barChoosePlan}
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
          submit();
        }}
      >
        <input
          ref={inputRef}
          className={styles.input}
          value={text}
          placeholder="Message"
          aria-label="Message"
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          className={styles.send}
          aria-label={editing ? COPY.chat.save : "Send"}
          disabled={!text.trim()}
        >
          <svg viewBox="0 0 24 24">{editing ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M12 19V5M5 12l7-7 7 7" />}</svg>
        </button>
      </form>
    </div>
  );
}
