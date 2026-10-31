/**
 * P2: thin typed wrappers around the server-state RPCs in
 * supabase/migrations/20260924000001_server_state.sql. Each returns data in
 * the shapes of src/state/schema.ts, so reducer payloads carry the server's
 * confirmed values. Errors are thrown as-is (PostgrestError); callers map
 * them to a toast.
 */

import type { Answers, Companion, Core, Gender, Ledger, Message } from "@/state/schema";
import type { SendStatus } from "@/lib/ledger";
import { getBrowserClient } from "@/lib/supabase/browser";
import { COPY } from "@/lib/copy";

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await getBrowserClient().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/** P3: raised by every mutating RPC while an admin has suspended the account. */
export function isSuspendedError(err: unknown): boolean {
  return (err as { message?: string } | null)?.message === "account_suspended";
}

/** The toast for a failed RPC: the suspension line, the edit rule that was hit, or the network line. */
export function rpcErrorMessage(err: unknown): string {
  if (isSuspendedError(err)) return COPY.auth.suspended;
  const m = (err as { message?: string } | null)?.message;
  if (m === "edit_window_closed") return COPY.chat.editWindowClosed;
  if (m === "edit_limit") return COPY.chat.editLimit;
  if (m === "message_deleted" || m === "message_not_found" || m === "quote_not_found") return COPY.chat.messageGone;
  return COPY.auth.network;
}

export interface ServerState {
  server_now: number;
  companions: Omit<Companion, "messages">[];
  messages_by_companion: Record<string, Message[]>;
  ledger: Ledger;
  profile: { display_name: string | null } | null;
  consent: { granted_at: number; marketing: boolean; version?: string } | null;
}

/** Companions with their messages attached, plus the ledger, as the client cache holds them. */
export function assembleServerState(s: ServerState): { companions: Companion[]; ledger: Ledger } {
  return {
    companions: s.companions.map((c) => ({ ...c, messages: s.messages_by_companion[c.id] ?? [] })),
    ledger: s.ledger,
  };
}

export function getMyState(): Promise<ServerState> {
  return call<ServerState>("get_my_state");
}

export function createCompanion(args: {
  templateId: string;
  deckGender: Gender;
  answers: Answers;
  core: Core;
  displayName: string;
}): Promise<Companion> {
  return call<Companion>("create_companion", {
    template_id: args.templateId,
    deck_gender: args.deckGender,
    answers: args.answers,
    core: args.core,
    display_name: args.displayName,
  });
}

/** Saves the caller's display name; the server validates it and returns the stored value. */
export function setDisplayName(name: string): Promise<string> {
  return call<string>("set_display_name", { p_name: name });
}

export interface SendResult {
  blocked: boolean;
  status: SendStatus;
  message: Message | null;
  exchanges: number;
  ledger: Ledger;
}

/** `replyTo` is the id of an earlier message in this chat the user is replying to. */
export function sendMessage(companionId: string, body: string, replyTo?: number | null): Promise<SendResult> {
  return call<SendResult>("send_message", { companion_id: companionId, body, reply_to: replyTo ?? null });
}

/** B3: edit one of the user's own messages (15 minutes, 5 edits). Free. */
export function editMessage(companionId: string, messageId: number, body: string): Promise<{ message: Message }> {
  return call("edit_message", { companion_id: companionId, message_id: messageId, body });
}

/** B3: delete either side's message. The server erases the text and keeps a tombstone. */
export function deleteMessage(companionId: string, messageId: number): Promise<{ message: Message }> {
  return call("delete_message", { companion_id: companionId, message_id: messageId });
}

export function receiveReply(companionId: string, body: string): Promise<{ message: Message; unread: number }> {
  return call("receive_reply", { companion_id: companionId, body });
}

/** Posts the opener only into an empty conversation; `message` is null otherwise. */
export function seedOpener(companionId: string, body: string): Promise<{ message: Message | null; unread: number }> {
  return call("seed_opener", { companion_id: companionId, body });
}

/** B2: the reply endpoint's response (app/api/chat/reply). */
export interface LiveReply {
  reaction: string | null;
  screen?: NonNullable<NonNullable<Message["meta"]>["screen"]> | null;
  bubbles: { id: number; text: string; meta: Message["meta"]; at: number }[];
  trustLevel: number;
  leveledUp: number | null;
  resourceCard: boolean;
  paused: boolean;
  replayed?: boolean;
}

/** QA only: what to force onto one reply. The server refuses it for anyone who is not QA or admin. */
export interface QaReplyOptions {
  ignoreCaps: boolean;
  force: { effect?: string | null; screen?: string | null; reaction?: string | null } | null;
}

export class LiveReplyError extends Error {
  constructor(readonly status: number) {
    super(`live_reply_${status}`);
  }
}

/** Asks the server for Ira's reply (or opener). 202 means one is already in flight. */
export async function requestLiveReply(companionId: string, mode: "reply" | "opener", qa?: QaReplyOptions | null): Promise<LiveReply | null> {
  const res = await fetch("/api/chat/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(qa ? { companionId, mode, qa } : { companionId, mode }),
  });
  if (res.status === 202) return null;
  if (!res.ok) throw new LiveReplyError(res.status);
  return (await res.json()) as LiveReply;
}

export function markCtxShown(companionId: string): Promise<void> {
  return call("mark_ctx_shown", { companion_id: companionId });
}

export function clearAgeCheck(companionId: string, dob: string): Promise<{ pausedReason: null }> {
  return call("clear_age_check", { companion_id: companionId, dob });
}

/** Records the live-chat consent (LIVE_CONSENT_VERSION) (the consents table allows a user's own insert). */
export async function insertConsent(userId: string, version: string): Promise<void> {
  const { error } = await getBrowserClient().from("consents").insert({ user_id: userId, version, marketing: false });
  if (error) throw error;
}

export function openChat(companionId: string): Promise<{ lastOpenedAt: number }> {
  return call("open_chat", { companion_id: companionId });
}

export function partCompanion(companionId: string): Promise<{ partedAt: number; purgeAt: number; ledger: Ledger }> {
  return call("part_companion", { companion_id: companionId });
}

export function unlockSlot(amount: number): Promise<{ ledger: Ledger }> {
  return call("unlock_slot", { amount });
}

export function buyPass(): Promise<{ ledger: Ledger }> {
  return call("buy_pass");
}

export function setCompanionPrefs(companionId: string, prefs: { notify?: boolean; sound?: boolean }): Promise<{ notify: boolean; sound: boolean }> {
  return call("set_companion_prefs", { companion_id: companionId, notify: prefs.notify ?? null, sound: prefs.sound ?? null });
}

// ---------------------------------------------------------------------------
// B3 QA tools (supabase/migrations/20261024000002_chat_actions_qa.sql)
// ---------------------------------------------------------------------------

/** True for a `qa` or `admin` profile. The server re-checks on every qa_* call. */
export async function isQa(): Promise<boolean> {
  const { data, error } = await getBrowserClient().rpc("is_qa");
  return !error && data === true;
}

/** Whether the profile is an admin, who also gets the link to the full console. */
export async function isAdminProfile(userId: string): Promise<boolean> {
  const { data } = await getBrowserClient().from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin";
}

export interface QaState {
  level: number;
  highestLevel: number;
  points: number;
  nextThreshold: number | null;
  relationshipDay: number;
  frozen: boolean;
  coolOff: boolean;
  safetyMode: boolean;
  effectsToday: Record<string, number>;
  screensToday: number;
}

export function qaSetLevel(companionId: string, level: number): Promise<{ trustLevel: number; levelChangedAt: number }> {
  return call("qa_set_level", { companion_id: companionId, lvl: level });
}

export function qaSetFreeze(companionId: string, freeze: boolean): Promise<{ frozen: boolean }> {
  return call("qa_set_freeze", { companion_id: companionId, freeze });
}

export function qaState(companionId: string): Promise<QaState> {
  return call("qa_state", { companion_id: companionId });
}

/** QA: adds a live test companion (a live face) to the caller's own account, or returns the one already active. */
export async function qaAddCompanion(templateId: string): Promise<Companion> {
  const c = await call<Companion>("qa_add_companion", { template_id: templateId });
  return { ...c, messages: c.messages ?? [] };
}

export function qaRefillMessages(): Promise<{ ledger: Ledger }> {
  return call("qa_refill_messages");
}

export function qaResetChat(companionId: string): Promise<{ reset: boolean }> {
  return call("qa_reset_chat", { companion_id: companionId });
}
