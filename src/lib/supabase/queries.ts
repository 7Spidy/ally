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

/** The toast for a failed RPC: the suspension line, or the network line. */
export function rpcErrorMessage(err: unknown): string {
  return isSuspendedError(err) ? COPY.auth.suspended : COPY.auth.network;
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

export interface SendResult {
  blocked: boolean;
  status: SendStatus;
  message: Message | null;
  exchanges: number;
  ledger: Ledger;
}

export function sendMessage(companionId: string, body: string): Promise<SendResult> {
  return call<SendResult>("send_message", { companion_id: companionId, body });
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
  screen?: "confetti" | "lanterns" | "rain" | "petals" | null;
  bubbles: { id: number; text: string; meta: Message["meta"]; at: number }[];
  trustLevel: number;
  leveledUp: number | null;
  resourceCard: boolean;
  paused: boolean;
  replayed?: boolean;
}

export class LiveReplyError extends Error {
  constructor(readonly status: number) {
    super(`live_reply_${status}`);
  }
}

/** Asks the server for Ira's reply (or opener). 202 means one is already in flight. */
export async function requestLiveReply(companionId: string, mode: "reply" | "opener"): Promise<LiveReply | null> {
  const res = await fetch("/api/chat/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companionId, mode }),
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

/** Records the v2-live-groq consent (the consents table allows a user's own insert). */
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
