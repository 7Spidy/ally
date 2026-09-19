/**
 * One-time migration from the v1 vanilla build's `ally_session` (and a
 * fresh boot) into the v2 `AllyState` shape. Idempotent: running it twice
 * with the same clock produces byte-identical output. Never touches
 * `ally_session`.
 */

import { dayKey } from "@/lib/clock";
import { emptyAnswers, emptyCore, freshFlow, freshLedger, type AllyState, type Answers, type Core, type Companion, type Gender } from "@/state/schema";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SESSION_KEY = "ally_session";
export const STATE_KEY = "ally_v2";
export const BLOCK_KEY = "ally_blocked_until";

/** True while a v1 under-18 block is still in force (ported from #ally-engine). */
export function isBlocked(storage: StorageLike, now: number): boolean {
  const until = Number(storage.getItem(BLOCK_KEY) || 0);
  return until > now;
}

// Old (v1) SCREENS index -> new route step name. Screens without a direct
// analogue (splash, confirm/account sheets) resolve to their nearest step.
const OLD_SCREEN_STEP: Record<number, string> = {
  0: "consent", // splash
  1: "consent",
  2: "location",
  3: "gender",
  4: "name",
  5: "birthday",
  6: "questions/disclosure",
  7: "questions/warmth",
  8: "questions/push",
  9: "questions/structure",
  10: "questions/nostalgia",
  11: "questions/pressure",
  12: "questions/interests",
  13: "matching",
  14: "deck",
  15: "proposal",
  16: "proposal", // confirm sheet sits over proposal
  17: "reveal",
};

interface V1State {
  screen: number;
  consentAt: number | null;
  consentMarketing: boolean;
  cityRaw: string;
  region: string | null;
  deckGender: Gender | null;
  displayName: string;
  dob: string | null;
  age: number | null;
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
  locked: string | null;
  lockedAt: number | null;
  soundOn: boolean;
  unmuted: boolean;
  messages: { who: "them" | "me"; text: string; at: number }[];
  exchanges: number;
  accountDismissed: number;
  accountAt: number | null;
  accountContact: string | null;
}

interface V1Session {
  savedAt: number;
  state: V1State;
}

function tryParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function inferAccountKind(contact: string | null): "phone" | "email" | null {
  if (!contact) return null;
  return contact.includes("@") ? "email" : "phone";
}

export function migrate(storage: StorageLike, now: number): AllyState {
  const v2 = tryParse<AllyState>(storage.getItem(STATE_KEY));
  if (v2) return v2;

  const day = dayKey(now);
  const v1 = tryParse<V1Session>(storage.getItem(SESSION_KEY));

  let next: AllyState;

  if (v1 && v1.state) {
    const s = v1.state;
    const user = {
      displayName: s.displayName ?? "",
      consentAt: s.consentAt ?? null,
      consentMarketing: !!s.consentMarketing,
      accountAt: s.accountAt ?? null,
      accountContact: s.accountContact ?? null,
      accountKind: inferAccountKind(s.accountContact ?? null),
      accountDismissed: s.accountDismissed ?? 0,
      soundOn: s.soundOn ?? true,
      unmuted: s.unmuted ?? false,
    };

    if (s.locked) {
      const companion: Companion = {
        id: "c_" + (v1.savedAt ?? now).toString(36),
        templateId: s.locked,
        deckGender: s.deckGender ?? "woman",
        answers: s.answers ?? emptyAnswers(),
        core: s.core ?? emptyCore(),
        createdAt: s.lockedAt ?? v1.savedAt ?? now,
        lastOpenedAt: v1.savedAt ?? now,
        status: "active",
        partedAt: null,
        purgeAt: null,
        messages: s.messages ?? [],
        exchanges: s.exchanges ?? 0,
        unread: 0,
        notify: true,
        sound: true,
      };
      next = {
        v: 2,
        savedAt: now,
        user,
        companions: [companion],
        ledger: freshLedger(day),
        flow: null,
      };
    } else {
      const step = OLD_SCREEN_STEP[s.screen] ?? "consent";
      next = {
        v: 2,
        savedAt: now,
        user,
        companions: [],
        ledger: freshLedger(day),
        flow: {
          kind: "first",
          step,
          cityRaw: s.cityRaw ?? "",
          region: s.region ?? null,
          deckGender: s.deckGender ?? null,
          displayName: s.displayName ?? "",
          dob: s.dob ?? null,
          age: s.age ?? null,
          answers: s.answers ?? emptyAnswers(),
          core: s.core ?? emptyCore(),
          deckOrder: s.deckOrder ?? [],
          deckIndex: s.deckIndex ?? 0,
          deckHistory: s.deckHistory ?? [],
          dwell: s.dwell ?? {},
          liked: s.liked ?? [],
          expanded: s.expanded ?? [],
          poolRemoved: s.poolRemoved ?? [],
          redraws: s.redraws ?? 0,
          canRedraw: s.canRedraw ?? false,
          proposed: s.proposed ?? null,
          proposalsSeen: s.proposalsSeen ?? 0,
          proposalMode: s.proposalMode ?? null,
        },
      };
    }
  } else {
    next = {
      v: 2,
      savedAt: now,
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
      flow: freshFlow("first", "consent"),
    };
  }

  storage.setItem(STATE_KEY, JSON.stringify(next));
  return next;
}
