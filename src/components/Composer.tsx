"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { COPY, fill } from "@/lib/copy";
import type { ComposerGate } from "@/lib/entitlement";
import styles from "./Composer.module.css";

export type ComposerVariant = ComposerGate;

/** Which plans-screen entry point a composer bar leads to. */
export type PlansFrom = "chats" | "locked" | "newally";

/** The box grows to this many lines, then scrolls. */
const MAX_LINES = 5;
const DRAFT_DEBOUNCE_MS = 300;

/** The localStorage key for one chat's unsent draft. */
export function draftKeyFor(uid: string, companionId: string): string {
  return `ally_draft:${uid}:${companionId}`;
}

function readDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(key: string, text: string): void {
  try {
    if (text.trim() === "") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, text);
  } catch {
    /* storage blocked: the draft just lives in the box */
  }
}

/**
 * Chat composer, gated by the user's plan (see composerGate in lib/entitlement).
 *  - `trialLimit`, `expired` and `locked` replace the composer with a bar that opens
 *    the plans screen (from=chats, locked, newally).
 *  - `fairUse` replaces it with a plain notice: no counter, no upsell.
 *  - `oneLeft` is the normal composer with a warning bar above it.
 *
 * The box is a textarea that grows to five lines. With a fine pointer (a mouse)
 * Enter sends and Shift+Enter adds a line; on touch Enter adds a line and only
 * the send button sends. `onSend` resolves false when the message did not go
 * through, and the text comes back if the box is still empty.
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
  draftKey,
}: {
  variant: ComposerVariant;
  onSend: (text: string) => Promise<boolean>;
  onOpenPlans: (from: PlansFrom) => void;
  /** B3: a quote chip above the input while a reply is being written. */
  replyingTo?: { label: string; text: string } | null;
  onCancelReply?: () => void;
  /** B3: editing one of your own messages. Free, so it ignores the message limits. */
  editing?: { id: number; text: string } | null;
  onSaveEdit?: (text: string) => void;
  onCancelEdit?: () => void;
  /** Where this chat's unsent text is kept (see draftKeyFor). No key, no draft. */
  draftKey?: string | null;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const variant: ComposerVariant = editing ? "normal" : baseVariant;
  // What was in the box before an edit began, put back when it ends.
  const stashRef = useRef("");
  const textRef = useRef(text);
  textRef.current = text;

  // Entering edit mode loads the message; leaving it puts back what was being written.
  const editingId = editing?.id ?? null;
  const editingText = editing?.text ?? "";
  useEffect(() => {
    if (editingId === null) return;
    stashRef.current = textRef.current;
    setText(editingText);
    inputRef.current?.focus();
  }, [editingId, editingText]);

  function endEdit() {
    setText(stashRef.current);
    stashRef.current = "";
  }

  const replyKey = replyingTo ? `${replyingTo.label}:${replyingTo.text}` : "";
  useEffect(() => {
    if (replyKey) inputRef.current?.focus();
  }, [replyKey]);

  // The draft: restored when the chat opens, written 300 ms after typing stops, flushed on leaving.
  const editingRef = useRef(false);
  editingRef.current = editingId !== null;
  useEffect(() => {
    if (!draftKey) return;
    const saved = readDraft(draftKey);
    if (saved && !editingRef.current) setText((cur) => (cur === "" ? saved : cur));
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey || editingId !== null) return;
    const t = setTimeout(() => writeDraft(draftKey, text), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, draftKey, editingId]);

  useEffect(
    () => () => {
      // Only a non-empty box is flushed: an emptied one was already cleared, and an early cleanup (React strict mode) must not wipe a draft that has not been restored yet.
      if (draftKey && !editingRef.current && textRef.current.trim() !== "") writeDraft(draftKey, textRef.current);
    },
    [draftKey]
  );

  // Grow with the text up to MAX_LINES, then scroll.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const cs = window.getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 22;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = line * MAX_LINES + pad;
    el.style.height = `${Math.min(el.scrollHeight + (parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)), max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text, variant]);

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
    const barText = variant === "trialLimit" ? COPY.chat.barTrialLimit : variant === "expired" ? COPY.chat.barExpired : COPY.chat.barLocked;
    const from: PlansFrom = variant === "trialLimit" ? "chats" : variant === "expired" ? "locked" : "newally";
    return (
      <div className={styles.wrap}>
        <button type="button" className={styles.planBar} data-testid={`composer-${variant}`} onClick={() => onOpenPlans(from)}>
          {barText}
        </button>
      </div>
    );
  }

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (editing) {
      onSaveEdit?.(trimmed);
      endEdit();
      return;
    }
    // Clear at once; if the send does not go through, the text comes back (unless something new was typed).
    setText("");
    if (draftKey) writeDraft(draftKey, "");
    const ok = await onSend(trimmed);
    if (!ok) setText((cur) => (cur === "" ? trimmed : cur));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    // Touch keyboards: Enter is a line break. A mouse and keyboard: Enter sends.
    if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      void submit();
    }
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
              endEdit();
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
          void submit();
        }}
      >
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          value={text}
          placeholder="Message"
          aria-label="Message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className={styles.send} aria-label={editing ? COPY.chat.save : "Send"} disabled={!text.trim()}>
          <svg viewBox="0 0 24 24">{editing ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M12 19V5M5 12l7-7 7 7" />}</svg>
        </button>
      </form>
    </div>
  );
}
