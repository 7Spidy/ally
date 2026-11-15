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
  return !m.deleted && !m.pending && m.text.length > 0;
}

export type ReceiptStatus = "delivered" | "read";

/**
 * iMessage-style receipt under the user's newest message: "Delivered" until
 * she has read it (`readUpTo`, the id of the newest message she has read, set
 * once the read delay has passed), or has answered, then "Read". Only the
 * newest user message carries one, and none while it is pending or after it
 * was deleted.
 */
export function receiptFor(messages: Message[], readUpTo: number | null): { index: number; status: ReceiptStatus } | null {
  let last = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].who === "me") {
      last = i;
      break;
    }
  }
  if (last < 0 || messages[last].deleted || messages[last].pending) return null;
  const answered = messages.slice(last + 1).some((m) => m.who === "them");
  const id = messages[last].id;
  const read = typeof id === "number" && readUpTo !== null && id <= readUpTo;
  return { index: last, status: answered || read ? "read" : "delivered" };
}

/** A temp id for a pending bubble: negative, so it never collides with a server id or counts as saved. */
let tempSeq = 0;
export function nextTempId(): number {
  tempSeq += 1;
  return -tempSeq;
}

/** True when a message arrived after the list first rendered, so it should play its entrance. */
export function isFresh(m: Message, initialIds: ReadonlySet<number>): boolean {
  return typeof m.id === "number" && !initialIds.has(m.id);
}

/**
 * After an edit, whether her reply is regenerated: only for a live companion
 * the plan lets the user talk to, when the edited message is the newest one of
 * the user's own and everything after it is her reply to it (or nothing yet),
 * and no reply is playing. The server re-checks all of it in retract_reply.
 */
export function canRegenerate(
  messages: Message[],
  editedId: number,
  ctx: { live: boolean; locked: boolean; expired: boolean; playing: boolean }
): boolean {
  if (!ctx.live || ctx.locked || ctx.expired || ctx.playing) return false;
  const at = messages.findIndex((m) => m.id === editedId);
  if (at < 0) return false;
  const edited = messages[at];
  if (edited.who !== "me" || edited.deleted || edited.pending) return false;
  for (let i = at + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m.who !== "them" || m.inReplyTo !== editedId) return false;
  }
  return true;
}
