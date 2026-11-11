import { PLAN_CONFIG, type EffectivePlan } from "@/lib/config";

export type CoreId = "ROMANTIC" | "PSYCH" | "MONEY" | "TRAINER" | "FRIEND";
export type Pressure = "money" | "health" | "head" | "alone" | "notgood" | "change";
export type Gender = "woman" | "man";

export interface Answers {
  /** q5 to q9 are the chosen option index, 0..3. */
  q5: number | null;
  q6: number | null;
  q7: number | null;
  q8: number | null;
  q9: number | null;
  q10: Pressure | null;
  q11: string[];
  /** Tiebreak winner, null if no tiebreak was needed. */
  tb: CoreId | null;
}

export interface Core {
  primary: CoreId | null;
  secondary: CoreId | null;
  weight: number | null;
  ranked: { id: CoreId; score: number }[];
}

/** B2: what the server stamped on a message (reaction, effect, quote). */
export interface MessageMeta {
  reaction?: string;
  effect?: "soft" | "loud" | "stop" | "ink" | "pin" | "screen" | "shake" | "sparkle" | "echo" | "bloom" | "heartbeat";
  /** The message this one replies to. Set by the server: by the model on her bubbles, by send_message on the user's. */
  quoteId?: number;
  screen?: "confetti" | "lanterns" | "rain" | "petals" | "balloons" | "fireworks" | "shootingstar" | "sparkles";
  safety?: boolean;
}

export interface Message {
  /** Server id. Absent on messages from a locally built state. */
  id?: number;
  who: "them" | "me";
  text: string;
  at: number;
  meta?: MessageMeta;
  inReplyTo?: number | null;
  /** B3: set when the user edited their message. */
  editedAt?: number | null;
  /** B3: a tombstone. The text is erased server-side; only the slot remains. */
  deleted?: boolean;
}

export interface Companion {
  id: string; // 'c_' + base36 timestamp
  templateId: string; // 'F01'..'M16'
  deckGender: Gender;
  answers: Answers;
  core: Core;
  createdAt: number;
  lastOpenedAt: number;
  status: "active" | "parted";
  partedAt: number | null;
  purgeAt: number | null;
  messages: Message[];
  exchanges: number;
  unread: number;
  notify: boolean;
  sound: boolean;
  /** B2 (live companions only meaningfully): trust level 1..6, never points or thresholds. */
  trustLevel?: number;
  levelChangedAt?: number | null;
  pausedReason?: "age_check" | null;
  lastCtxDay?: string | null;
  /** Server-computed: this companion replies from the live model (see ally_private.is_live). */
  live?: boolean;
  /** Plans: the stored trust is past this plan's ceiling (trustLevel is clamped). */
  deeperLevelAvailable?: boolean;
  /** Plans: the "deeper level" chat banner has been shown for this companion. */
  deeperShown?: boolean;
}

/**
 * What is left of the old ledger: the Asia/Kolkata day, how many chats were
 * sent that day, and the faces that were parted. The plan, the allowance and
 * the slots now come from the server as an `Entitlement`.
 */
export interface Ledger {
  parted: string[]; // templateIds, permanent
  day: string; // Asia/Kolkata YYYY-MM-DD
  freeUsed: number;
}

/** What the caller's plan allows, from the server (get_my_state / get_entitlement). Never trusted from storage. */
export interface Entitlement {
  plan: EffectivePlan;
  /** Epoch ms. Set on the trial only. */
  trialEndsAt: number | null;
  /** 1..7 on the trial, else null. */
  trialDay: number | null;
  slotLimit: number;
  /** Highest trust level the engine uses for this plan. */
  maxLevel: number;
  canSend: boolean;
  /** Set on the trial only. A paid plan's hidden cap is never sent. */
  chatsLeftToday: number | null;
  capReached: boolean;
}

export interface OnboardingFlow {
  kind: "first" | "round2";
  step: string; // route segment name, e.g. 'gender', 'questions/warmth'
  cityRaw: string;
  region: string | null;
  deckGender: Gender | null;
  displayName: string;
  dob: string | null;
  age: number | null; // 'first' only
  answers: Answers;
  core: Core;
  deckOrder: string[];
  deckIndex: number;
  deckHistory: string[];
  dwell: Record<string, number>;
  liked: string[];
  expanded: string[];
  poolRemoved: string[];
  redraws: number;
  canRedraw: boolean;
  proposed: string | null;
  proposalsSeen: number;
  proposalMode: string | null;
  /** The first-deck tutorial has played (or been skipped) on this flow. */
  tutorialShown: boolean;
}

export interface AllyUser {
  displayName: string;
  consentAt: number | null;
  consentMarketing: boolean;
  /** Version of the newest consent row, from the server. Absent until loaded. */
  consentVersion?: string | null;
  accountAt: number | null;
  accountContact: string | null;
  accountKind: "phone" | "email" | null;
  accountDismissed: number;
  soundOn: boolean;
  unmuted: boolean;
}

export interface AllyState {
  v: 4;
  savedAt: number;
  user: AllyUser;
  companions: Companion[];
  ledger: Ledger;
  entitlement: Entitlement;
  flow: OnboardingFlow | null;
}

export function emptyAnswers(): Answers {
  return { q5: null, q6: null, q7: null, q8: null, q9: null, q10: null, q11: [], tb: null };
}

export function emptyCore(): Core {
  return { primary: null, secondary: null, weight: null, ranked: [] };
}

export function freshFlow(kind: "first" | "round2", step: string): OnboardingFlow {
  return {
    kind,
    step,
    cityRaw: "",
    region: null,
    deckGender: null,
    displayName: "",
    dob: null,
    age: null,
    answers: emptyAnswers(),
    core: emptyCore(),
    deckOrder: [],
    deckIndex: 0,
    deckHistory: [],
    dwell: {},
    liked: [],
    expanded: [],
    poolRemoved: [],
    redraws: 0,
    canRedraw: false,
    proposed: null,
    proposalsSeen: 0,
    proposalMode: null,
    tutorialShown: false,
  };
}

export function freshLedger(day: string): Ledger {
  return { parted: [], day, freeUsed: 0 };
}

/** The placeholder before the server has answered: a new user on day 1 of the trial. Replaced on hydrate. */
export function freshEntitlement(): Entitlement {
  return {
    plan: "trial",
    trialEndsAt: null,
    trialDay: 1,
    slotLimit: PLAN_CONFIG.trial.slots,
    maxLevel: PLAN_CONFIG.trial.maxLevel,
    canSend: true,
    chatsLeftToday: PLAN_CONFIG.trial.dailyChats,
    capReached: false,
  };
}

export function freshState(nowMs: number, day: string): AllyState {
  return {
    v: 4,
    savedAt: nowMs,
    user: {
      displayName: "",
      consentAt: null,
      consentMarketing: false,
      accountAt: null,
      accountContact: null,
      accountKind: null,
      accountDismissed: 0,
      soundOn: true,
      unmuted: false,
    },
    companions: [],
    ledger: freshLedger(day),
    entitlement: freshEntitlement(),
    flow: freshFlow("first", "consent"),
  };
}
