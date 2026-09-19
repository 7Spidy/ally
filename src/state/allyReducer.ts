import type { AllyState, Answers, Companion, Gender, OnboardingFlow } from "@/state/schema";
import { emptyAnswers, emptyCore, freshFlow } from "@/state/schema";
import { computeCore } from "@/lib/engine";
import { rollDay, spend, buyPass as ledgerBuyPass, unlock as ledgerUnlock } from "@/lib/ledger";
import { PART_PURGE_DAYS, MAX_COMPANIONS } from "@/lib/config";
import { replyFor } from "@/lib/copy";

export type AllyAction =
  | { type: "HYDRATE"; state: AllyState }
  | { type: "CONSENT"; marketing: boolean; now: number }
  | { type: "SET_LOCATION"; cityRaw: string; region: string | null }
  | { type: "SET_GENDER"; gender: Gender }
  | { type: "SET_NAME"; name: string }
  | { type: "SET_BIRTHDAY"; dob: string | null; age: number | null }
  | { type: "SET_ANSWER"; key: keyof Answers; value: Answers[keyof Answers] }
  | { type: "SET_FLOW_STEP"; step: string }
  | { type: "INVALIDATE"; patch: Partial<OnboardingFlow> }
  | { type: "COMPUTE_CORE" }
  | { type: "DECK_INIT"; deckOrder: string[] }
  | { type: "DECK_DWELL"; id: string; ms: number }
  | { type: "DECK_LIKE"; id: string }
  | { type: "DECK_EXPAND"; id: string }
  | { type: "DECK_ADVANCE" }
  | { type: "DECK_UNDO" }
  | { type: "PROPOSE"; result: { proposed: string | null; canRedraw: boolean; mode: string | null } }
  | { type: "REDRAW" }
  | { type: "START_ROUND2"; templates: { id: string; gender: Gender }[] }
  | { type: "LEAVE_ROUND2" }
  | { type: "RESET_FIRST_RUN_FLOW" }
  | { type: "CONFIRM_LOCK"; templateId: string; now: number }
  | { type: "ROUTER_LOCK_CLEAR" }
  | { type: "SEND_MESSAGE"; companionId: string; text: string; now: number }
  | { type: "RECEIVE_REPLY"; companionId: string; now: number }
  | { type: "SEED_OPENER"; companionId: string; text: string; now: number }
  | { type: "OPEN_CHAT"; companionId: string; now: number }
  | { type: "ACCOUNT_SAVE"; contact: string; kind: "phone" | "email"; now: number }
  | { type: "ACCOUNT_DISMISS" }
  | { type: "UNLOCK_SLOT"; amount: number; now: number }
  | { type: "BUY_PASS"; now: number }
  | { type: "SPEND_MESSAGE"; now: number }
  | { type: "PART_COMPANION"; companionId: string; now: number }
  | { type: "PURGE_PARTED"; now: number }
  | { type: "SET_NOTIFY"; companionId: string; notify: boolean }
  | { type: "SET_SOUND"; companionId: string; sound: boolean }
  | { type: "SET_SOUND_ON"; soundOn: boolean }
  | { type: "SET_UNMUTED"; unmuted: boolean }
  | { type: "DELETE_ALL"; now: number }
  | { type: "DEBUG_SEED_COMPANION"; companion: Companion }
  | { type: "DEBUG_FREE_LEFT"; n: number }
  | { type: "DEBUG_PASS_USED"; n: number }
  | { type: "DEBUG_START_PASS"; now: number }
  | { type: "DEBUG_PART_ALL"; now: number };

function updateCompanion(state: AllyState, id: string, fn: (c: Companion) => Companion): AllyState {
  return { ...state, companions: state.companions.map((c) => (c.id === id ? fn(c) : c)) };
}

function requireFlow(state: AllyState): OnboardingFlow {
  if (!state.flow) throw new Error("allyReducer: action requires an active flow");
  return state.flow;
}

export function allyReducer(state: AllyState, action: AllyAction): AllyState {
  switch (action.type) {
    case "HYDRATE":
      return action.state;

    case "CONSENT":
      return { ...state, user: { ...state.user, consentAt: action.now, consentMarketing: action.marketing } };

    case "SET_LOCATION":
      return { ...state, flow: { ...requireFlow(state), cityRaw: action.cityRaw, region: action.region } };

    case "SET_GENDER":
      return { ...state, flow: { ...requireFlow(state), deckGender: action.gender } };

    case "SET_NAME":
      return { ...state, flow: { ...requireFlow(state), displayName: action.name } };

    case "SET_BIRTHDAY":
      return { ...state, flow: { ...requireFlow(state), dob: action.dob, age: action.age } };

    case "SET_ANSWER": {
      const flow = requireFlow(state);
      return { ...state, flow: { ...flow, answers: { ...flow.answers, [action.key]: action.value } } };
    }

    case "SET_FLOW_STEP":
      return { ...state, flow: { ...requireFlow(state), step: action.step } };

    case "INVALIDATE":
      return { ...state, flow: { ...requireFlow(state), ...action.patch } };

    case "COMPUTE_CORE": {
      const flow = requireFlow(state);
      return { ...state, flow: { ...flow, core: computeCore(flow.answers) } };
    }

    case "DECK_INIT":
      return {
        ...state,
        flow: {
          ...requireFlow(state),
          deckOrder: action.deckOrder,
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
        },
      };

    case "DECK_DWELL": {
      const flow = requireFlow(state);
      const cap = 15000;
      const ms = Math.min(cap, (flow.dwell[action.id] || 0) + action.ms);
      return { ...state, flow: { ...flow, dwell: { ...flow.dwell, [action.id]: ms } } };
    }

    case "DECK_LIKE": {
      const flow = requireFlow(state);
      if (flow.liked.includes(action.id)) return state;
      return { ...state, flow: { ...flow, liked: [...flow.liked, action.id] } };
    }

    case "DECK_EXPAND": {
      const flow = requireFlow(state);
      if (flow.expanded.includes(action.id)) return state;
      return { ...state, flow: { ...flow, expanded: [...flow.expanded, action.id] } };
    }

    case "DECK_ADVANCE": {
      const flow = requireFlow(state);
      const id = flow.deckOrder[flow.deckIndex];
      return { ...state, flow: { ...flow, deckIndex: flow.deckIndex + 1, deckHistory: id ? [...flow.deckHistory, id] : flow.deckHistory } };
    }

    case "DECK_UNDO": {
      const flow = requireFlow(state);
      if (!flow.deckHistory.length) return state;
      return { ...state, flow: { ...flow, deckIndex: Math.max(0, flow.deckIndex - 1), deckHistory: flow.deckHistory.slice(0, -1) } };
    }

    case "PROPOSE": {
      const flow = requireFlow(state);
      return {
        ...state,
        flow: {
          ...flow,
          proposed: action.result.proposed,
          canRedraw: action.result.canRedraw,
          proposalMode: action.result.mode,
          proposalsSeen: flow.proposalsSeen + 1,
        },
      };
    }

    case "REDRAW": {
      const flow = requireFlow(state);
      const removed = flow.proposed ? [...flow.poolRemoved, flow.proposed] : flow.poolRemoved;
      return { ...state, flow: { ...flow, poolRemoved: removed, redraws: flow.redraws + 1 } };
    }

    case "START_ROUND2": {
      const flow = freshFlow("round2", "gender");
      return { ...state, flow };
    }

    case "LEAVE_ROUND2":
      return { ...state, flow: null };

    case "RESET_FIRST_RUN_FLOW":
      return { ...state, flow: freshFlow("first", "consent") };

    case "CONFIRM_LOCK": {
      const flow = requireFlow(state);
      if (!action.templateId) throw new Error("confirmLock without a template");
      const companion: Companion = {
        id: "c_" + action.now.toString(36),
        templateId: action.templateId,
        deckGender: flow.deckGender as Gender,
        answers: flow.answers,
        core: flow.core,
        createdAt: action.now,
        lastOpenedAt: action.now,
        status: "active",
        partedAt: null,
        purgeAt: null,
        messages: [],
        exchanges: 0,
        unread: 0,
        notify: true,
        sound: true,
      };
      const displayName = flow.displayName || state.user.displayName;
      return { ...state, companions: [...state.companions, companion], flow: null, user: { ...state.user, displayName } };
    }

    case "SEND_MESSAGE": {
      const now = action.now;
      let next = updateCompanion(state, action.companionId, (c) => ({
        ...c,
        messages: [...c.messages, { who: "me", text: action.text, at: now }],
        exchanges: c.exchanges + 1,
      }));
      next = { ...next, ledger: spend(rollDay(next.ledger, now), now) };
      return next;
    }

    case "RECEIVE_REPLY": {
      const companion = state.companions.find((c) => c.id === action.companionId);
      if (!companion || !companion.core.primary) return state;
      const text = replyFor(companion.core.primary, companion.exchanges);
      return updateCompanion(state, action.companionId, (c) => ({
        ...c,
        messages: [...c.messages, { who: "them", text, at: action.now }],
        unread: c.unread + 1,
      }));
    }

    case "SEED_OPENER": {
      const companion = state.companions.find((c) => c.id === action.companionId);
      if (!companion || companion.messages.length > 0) return state;
      return updateCompanion(state, action.companionId, (c) => ({
        ...c,
        messages: [...c.messages, { who: "them", text: action.text, at: action.now }],
        unread: c.unread + 1,
      }));
    }

    case "OPEN_CHAT":
      return updateCompanion(state, action.companionId, (c) => ({ ...c, lastOpenedAt: action.now, unread: 0 }));

    case "ACCOUNT_SAVE":
      return { ...state, user: { ...state.user, accountAt: action.now, accountContact: action.contact, accountKind: action.kind } };

    case "ACCOUNT_DISMISS":
      return { ...state, user: { ...state.user, accountDismissed: state.user.accountDismissed + 1 } };

    case "UNLOCK_SLOT":
      return { ...state, ledger: ledgerUnlock(state.ledger, action.amount, action.now) };

    case "BUY_PASS":
      return { ...state, ledger: ledgerBuyPass(rollDay(state.ledger, action.now), action.now) };

    case "SPEND_MESSAGE":
      return { ...state, ledger: spend(rollDay(state.ledger, action.now), action.now) };

    case "PART_COMPANION": {
      const purgeAt = action.now + PART_PURGE_DAYS * 86400000;
      const companion = state.companions.find((c) => c.id === action.companionId);
      const parted = companion ? [...state.ledger.parted, companion.templateId] : state.ledger.parted;
      return {
        ...updateCompanion(state, action.companionId, (c) => ({ ...c, status: "parted", partedAt: action.now, purgeAt })),
        ledger: { ...state.ledger, parted },
      };
    }

    case "PURGE_PARTED":
      return {
        ...state,
        companions: state.companions.map((c) =>
          c.status === "parted" && c.purgeAt !== null && c.purgeAt <= action.now
            ? { ...c, messages: [], answers: emptyAnswers(), core: emptyCore(), unread: 0 }
            : c
        ),
      };

    case "SET_NOTIFY":
      return updateCompanion(state, action.companionId, (c) => ({ ...c, notify: action.notify }));

    case "SET_SOUND":
      return updateCompanion(state, action.companionId, (c) => ({ ...c, sound: action.sound }));

    case "SET_SOUND_ON":
      return { ...state, user: { ...state.user, soundOn: action.soundOn } };

    case "SET_UNMUTED":
      return { ...state, user: { ...state.user, unmuted: action.unmuted } };

    case "DELETE_ALL":
      return {
        v: 2,
        savedAt: action.now,
        user: { displayName: "", consentAt: null, consentMarketing: false, accountAt: null, accountContact: null, accountKind: null, accountDismissed: 0, soundOn: true, unmuted: false },
        companions: [],
        ledger: { slotsUnlocked: 1, unlocks: [], parted: [], day: state.ledger.day, freeUsed: 0, pass: null, passes: [] },
        flow: freshFlow("first", "consent"),
      };

    case "DEBUG_SEED_COMPANION":
      if (state.companions.filter((c) => c.status === "active").length >= MAX_COMPANIONS) return state;
      return { ...state, companions: [...state.companions, action.companion] };

    case "DEBUG_FREE_LEFT":
      return { ...state, ledger: { ...state.ledger, freeUsed: Math.max(0, 100 - action.n) } };

    case "DEBUG_PASS_USED":
      return state.ledger.pass ? { ...state, ledger: { ...state.ledger, pass: { ...state.ledger.pass, used: action.n } } } : state;

    case "DEBUG_START_PASS":
      return { ...state, ledger: ledgerBuyPass(state.ledger, action.now) };

    case "DEBUG_PART_ALL":
      return {
        ...state,
        companions: state.companions.map((c) => (c.status === "active" ? { ...c, status: "parted", partedAt: action.now, purgeAt: action.now + PART_PURGE_DAYS * 86400000 } : c)),
        ledger: { ...state.ledger, parted: [...new Set([...state.ledger.parted, ...state.companions.filter((c) => c.status === "active").map((c) => c.templateId)])] },
      };

    default:
      return state;
  }
}
