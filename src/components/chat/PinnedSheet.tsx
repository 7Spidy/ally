"use client";

import { useEffect, useState } from "react";
import type { Message } from "@/state/schema";
import { Sheet } from "@/components/Sheet";
import { COPY } from "@/lib/copy";
import { dayLabel } from "@/lib/chatDates";
import { now } from "@/lib/clock";
import { getPinnedMessages, rpcErrorMessage } from "@/lib/supabase/queries";
import styles from "./PinnedSheet.module.css";

/**
 * The messages she pinned in this chat, newest first. Tapping one closes the
 * sheet and jumps to it (loading older pages first if it is not on screen).
 * Opened from the chat's overflow menu, so it closes itself rather than going
 * through the sheet stack.
 */
export function PinnedSheet({
  companionId,
  onJump,
  onClose,
  onError,
}: {
  companionId: string;
  onJump: (id: number) => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [pins, setPins] = useState<Message[] | null>(null);

  useEffect(() => {
    let alive = true;
    getPinnedMessages(companionId)
      .then((list) => alive && setPins(list))
      .catch((e) => {
        if (!alive) return;
        setPins([]);
        onError(rpcErrorMessage(e));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const nowMs = now();
  return (
    <Sheet labelledBy="pinnedHeading" onScrimTap={onClose}>
      <h2 id="pinnedHeading" className={styles.heading}>
        {COPY.chat.overflowPins}
      </h2>
      {pins !== null && pins.length === 0 && (
        <p className={styles.empty} data-testid="pins-empty">
          {COPY.chat.pinsEmpty}
        </p>
      )}
      {pins !== null && pins.length > 0 && (
        <ul className={styles.list}>
          {pins.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className={styles.row}
                data-testid="pinned-row"
                onClick={() => {
                  onClose();
                  if (typeof m.id === "number") onJump(m.id);
                }}
              >
                <span className={styles.text}>{m.text}</span>
                <span className={styles.date}>{dayLabel(m.at, nowMs)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
