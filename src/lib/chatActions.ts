/**
 * Pure rules for the message actions (edit, delete, reply) and the delivery
 * receipt. The server is the authority (edit_message / delete_message in
 * 20261024000002_chat_actions_qa.sql); these only decide what the menu offers.
 */

import type { Message } from "@/state/schema";

/** Mirrors the SQL: 15 minutes. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** An id from the server. Local previews and unsaved bubbles have none, or a negative one. */
export function isSaved(m: Message): m is Message & { id: number } {
  return typeof m.id === "number" && m.id > 0;
}

export function canEdit(m: Message, nowMs: number): boolean {
  return isSaved(m) && m.who === "me" && !m.deleted && nowMs - m.at <= EDIT_WINDOW_MS;
}

export function canDelete(m: Message): boolean {
  return isSaved(m) && !m.deleted;
}

export function canReply(m: Message): boolean {
  return isSaved(m) && !m.deleted;
}

export function canCopy(m: Message): boolean {
  return !m.deleted && m.text.length > 0;
}

export type ReceiptStatus = "delivered" | "read";

/**
 * iMessage-style receipt under the user's newest message: "Delivered" until
 * the companion starts typing or answers, then "Read". Only the newest user
 * message carries one, and none when that message was deleted.
 */
export function receiptFor(messages: Message[], typing: boolean): { index: number; status: ReceiptStatus } | null {
  let last = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].who === "me") {
      last = i;
      break;
    }
  }
  if (last < 0 || messages[last].deleted) return null;
  const answered = messages.slice(last + 1).some((m) => m.who === "them");
  return { index: last, status: answered || typing ? "read" : "delivered" };
}

/** True when a message arrived after the list first rendered, so it should play its entrance. */
export function isFresh(m: Message, initialIds: ReadonlySet<number>): boolean {
  return typeof m.id === "number" && !initialIds.has(m.id);
}
