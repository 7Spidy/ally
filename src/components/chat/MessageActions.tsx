"use client";

import { useEffect, useRef, useState } from "react";
import type { Message } from "@/state/schema";
import { COPY } from "@/lib/copy";
import { canCopy, canDelete, canEdit, canReply } from "@/lib/chatActions";
import sheet from "@/components/Sheet.module.css";
import styles from "./MessageActions.module.css";

/**
 * The long-press menu for one message: Reply, Copy, Edit (yours, inside the
 * window) and Delete (two taps). Closes on the scrim, Escape or Cancel.
 */
export function MessageActions({
  message,
  nowMs,
  onReply,
  onCopy,
  onEdit,
  onDelete,
  onClose,
}: {
  message: Message;
  nowMs: number;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows: { key: string; label: string; show: boolean; run: () => void }[] = [
    { key: "reply", label: COPY.chat.reply, show: canReply(message), run: onReply },
    { key: "copy", label: COPY.chat.copy, show: canCopy(message), run: onCopy },
    { key: "edit", label: COPY.chat.edit, show: canEdit(message, nowMs), run: onEdit },
  ];
  const visible = rows.filter((r) => r.show);

  return (
    <>
      <div className={sheet.scrim} onClick={onClose} data-testid="actions-scrim" />
      <div className={`${sheet.panel} ${styles.panel}`} role="dialog" aria-modal="true" aria-label="Message actions" data-testid="message-actions">
        <p className={styles.preview}>{message.text}</p>
        <div className={styles.list} role="menu">
          {!confirming &&
            visible.map((r, i) => (
              <button key={r.key} ref={i === 0 ? firstRef : undefined} type="button" role="menuitem" className={styles.row} onClick={r.run}>
                {r.label}
              </button>
            ))}
          {canDelete(message) &&
            (confirming ? (
              <>
                <button ref={firstRef} type="button" role="menuitem" className={`${styles.row} ${styles.danger}`} onClick={onDelete}>
                  {COPY.chat.deleteConfirm}
                </button>
                <button type="button" role="menuitem" className={styles.row} onClick={() => setConfirming(false)}>
                  {COPY.chat.cancel}
                </button>
              </>
            ) : (
              <button type="button" role="menuitem" className={`${styles.row} ${styles.danger}`} onClick={() => setConfirming(true)}>
                {COPY.chat.delete}
              </button>
            ))}
        </div>
      </div>
    </>
  );
}
