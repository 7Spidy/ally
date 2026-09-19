export type CoreId = "KIAAN" | "MEHER" | "ANANYA" | "VEER" | "PRIYA" | "ANAY";
export type Pressure = "money" | "health" | "head" | "alone" | "notgood" | "change";
export type Gender = "woman" | "man";

export interface Answers {
  q5: number | null;
  q6: number | null;
  q7: number | null;
  q8: number | null;
  q9: number | null;
  q10: Pressure | null;
  q11: string[];
}

export interface Core {
  primary: CoreId | null;
  secondary: CoreId | null;
  weight: number | null;
  ranked: { id: CoreId; score: number }[];
}

export interface Message {
  who: "them" | "me";
  text: string;
  at: number;
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
}

export interface LedgerUnlock {
  slot: number;
  at: number;
  amount: number;
}

export interface LedgerPass {
  startedAt: number;
  endsAt: number;
  used: number;
}

export interface LedgerPassHistory {
  startedAt: number;
  amount: number;
}

export interface Ledger {
  slotsUnlocked: number; // 1..3
  unlocks: LedgerUnlock[];
  parted: string[]; // templateIds, permanent
  day: string; // Asia/Kolkata YYYY-MM-DD
  freeUsed: number;
  pass: LedgerPass | null;
  passes: LedgerPassHistory[];
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
}

export interface AllyUser {
  consentAt: number | null;
  consentMarketing: boolean;
  accountAt: number | null;
  accountContact: string | null;
  accountKind: "phone" | "email" | null;
  accountDismissed: number;
  soundOn: boolean;
  unmuted: boolean;
}

export interface AllyState {
  v: 2;
  savedAt: number;
  user: AllyUser;
  companions: Companion[];
  ledger: Ledger;
  flow: OnboardingFlow | null;
}

export function emptyAnswers(): Answers {
  return { q5: null, q6: null, q7: null, q8: null, q9: null, q10: null, q11: [] };
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
  };
}

export function freshLedger(day: string): Ledger {
  return {
    slotsUnlocked: 1,
    unlocks: [],
    parted: [],
    day,
    freeUsed: 0,
    pass: null,
    passes: [],
  };
}

export function freshState(nowMs: number, day: string): AllyState {
  return {
    v: 2,
    savedAt: nowMs,
    user: {
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
    flow: freshFlow("first", "consent"),
  };
}
