/**
 * One-time migration from the v1 vanilla build's `ally_session` (and a
 * fresh boot) into the current `AllyState` shape, plus the v2 -> v3 upgrade
 * (B1: six cores to five, option-index answers). Idempotent: running it
 * twice with the same clock produces byte-identical output. Never touches
 * `ally_session`.
 */

import { dayKey } from "@/lib/clock";
import { emptyAnswers, emptyCore, freshFlow, freshLedger, type AllyState, type Answers, type Core, type CoreId, type Companion, type Gender, type OnboardingFlow } from "@/state/schema";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RemovableStorage extends StorageLike {
  removeItem(key: string): void;
}

export const SESSION_KEY = "ally_session";
/** The pre-P1, un-namespaced key. Per-user state lives under stateKeyFor(uid). */
export const STATE_KEY = "ally_v2";
export const BLOCK_KEY = "ally_blocked_until";

/** P1 (spec §5.2): state is namespaced per Supabase user so two people on one device never share it. */
export function stateKeyFor(uid: string): string {
  return STATE_KEY + ":" + uid;
}

/**
 * P1 (spec D12): delete the legacy un-namespaced `ally_v2` key. Removes that
 * exact key only, never `ally_v2:*`, `ally_blocked_until` or `ally_session`.
 */
export function wipeLegacy(storage: RemovableStorage): void {
  storage.removeItem(STATE_KEY);
}

/**
 * P2 (spec D1, §6.4): companions and the ledger are server-owned. The local
 * `ally_v2:<uid>` blob keeps only `flow` and `user`; whatever companions or
 * ledger it holds (including pre-P2 data) are replaced by empty defaults,
 * never read. Used on both hydrate and persist.
 */
export function localOnly(state: AllyState, day: string): AllyState {
  return { ...state, companions: [], ledger: freshLedger(day) };
}

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
  10: "questions/offday",
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

// ---- v2 -> v3 (B1, five cores) ----

/** Old six-core ids (and the five new ones, so the map is idempotent) to the new ids. */
export const CORE_ID_MAP: Record<string, CoreId> = {
  KIAAN: "ROMANTIC",
  MEHER: "PSYCH",
  ANANYA: "MONEY",
  VEER: "TRAINER",
  PRIYA: "FRIEND",
  ANAY: "FRIEND",
  ROMANTIC: "ROMANTIC",
  PSYCH: "PSYCH",
  MONEY: "MONEY",
  TRAINER: "TRAINER",
  FRIEND: "FRIEND",
};

function mapCoreId(id: string | null | undefined): CoreId | null {
  return id ? (CORE_ID_MAP[id] ?? null) : null;
}

/** A core as stored before B1: ids are plain strings, possibly the old six. */
interface StoredCore {
  primary: string | null;
  secondary: string | null;
  weight: number | null;
  ranked: { id: string; score: number }[];
}

/** Rewrites primary, secondary and every ranked id; ANAY -> FRIEND duplicates keep the higher score. */
export function upgradeCore(core: StoredCore | null | undefined): Core {
  if (!core) return emptyCore();
  const primary = mapCoreId(core.primary);
  let secondary = mapCoreId(core.secondary);
  let weight = core.weight;
  if (secondary && secondary === primary) {
    secondary = null;
    weight = 100;
  }
  const best = new Map<CoreId, number>();
  for (const r of core.ranked ?? []) {
    const id = mapCoreId(r.id);
    if (!id) continue;
    best.set(id, Math.max(best.get(id) ?? -Infinity, r.score));
  }
  const ranked = [...best.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
  return { primary, secondary, weight, ranked };
}

function upgradeAnswers(a: Answers | null | undefined): Answers {
  return { ...emptyAnswers(), ...(a ?? {}), tb: mapCoreId(a?.tb) };
}

const SCORED_QUESTIONS = ["q5", "q6", "q7", "q8", "q9"] as const;

/**
 * B1 changed what q5..q9 mean (slider floats became option indices) and what
 * the core decides (the deck), so nothing derived from the old answers can be
 * trusted, integer or not. Every existing flow drops q5..q9, the tiebreak, the
 * core, the deck and the proposal. Where the user had answered any of q5..q9
 * they restart at the first question. A flow that had answered none keeps its
 * step (the removed nostalgia step resumes at offday).
 */
function upgradeFlow(flow: OnboardingFlow): OnboardingFlow {
  const answers = upgradeAnswers(flow.answers);
  const hadAnswers = SCORED_QUESTIONS.some((q) => answers[q] != null);
  return {
    ...flow,
    step: hadAnswers ? "questions/disclosure" : flow.step === "questions/nostalgia" ? "questions/offday" : flow.step,
    answers: { ...answers, q5: null, q6: null, q7: null, q8: null, q9: null, tb: null },
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
    tutorialShown: flow.tutorialShown ?? false,
  };
}

/** Brings any stored state up to v3. A state already at v3 is returned unchanged. */
export function upgradeState(raw: AllyState | (Omit<AllyState, "v"> & { v: number })): AllyState {
  if (raw.v === 3) return raw as AllyState;
  return {
    ...raw,
    v: 3,
    companions: (raw.companions ?? []).map((c) => ({ ...c, answers: upgradeAnswers(c.answers), core: upgradeCore(c.core) })),
    flow: raw.flow ? upgradeFlow(raw.flow) : null,
  };
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

export function migrate(storage: StorageLike, now: number, key: string = STATE_KEY): AllyState {
  const stored = tryParse<AllyState | (Omit<AllyState, "v"> & { v: number })>(storage.getItem(key));
  if (stored) {
    const upgraded = upgradeState(stored);
    if (upgraded !== stored) storage.setItem(key, JSON.stringify(upgraded));
    return upgraded;
  }

  const day = dayKey(now);
  // The v1 `ally_session` only feeds the legacy un-namespaced key. A
  // per-user key must never inherit another person's device-local v1 data.
  const v1 = key === STATE_KEY ? tryParse<V1Session>(storage.getItem(SESSION_KEY)) : null;

  let next: AllyState;

  if (v1 && v1.state) {
    // v1 answers and core ids are pre-B1 too: they go through the same upgrade as stored v2 state.
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
        answers: upgradeAnswers(s.answers),
        core: upgradeCore(s.core),
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
        v: 3,
        savedAt: now,
        user,
        companions: [companion],
        ledger: freshLedger(day),
        flow: null,
      };
    } else {
      const step = OLD_SCREEN_STEP[s.screen] ?? "consent";
      next = {
        v: 3,
        savedAt: now,
        user,
        companions: [],
        ledger: freshLedger(day),
        flow: upgradeFlow({
          kind: "first",
          step,
          cityRaw: s.cityRaw ?? "",
          region: s.region ?? null,
          deckGender: s.deckGender ?? null,
          displayName: s.displayName ?? "",
          dob: s.dob ?? null,
          age: s.age ?? null,
          answers: upgradeAnswers(s.answers),
          core: upgradeCore(s.core),
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
          tutorialShown: false,
        }),
      };
    }
  } else {
    next = {
      v: 3,
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

  storage.setItem(key, JSON.stringify(next));
  return next;
}
