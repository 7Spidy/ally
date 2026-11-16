"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useAuth } from "@/state/useAuth";
import { useSheet } from "@/state/useSheet";
import { useManifest } from "@/state/useManifest";
import { useToast } from "@/state/useToast";
import { ManifestGate } from "@/components/ManifestGate";
import { byId } from "@/lib/selectors";
import { composerGate, isSendCode, lockedCompanionIds } from "@/lib/entitlement";
import { canRegenerate, isSaved, nextTempId } from "@/lib/chatActions";
import { readDelayMs, tierFor } from "@/lib/readDelay";
import { pronounsFor } from "@/personas/pronouns";
import { openerFor, replyFor, COPY, fill } from "@/lib/copy";
import { firstNameFromFull } from "@/lib/engine";
import { dayKey, now } from "@/lib/clock";
import { BLOCK_DAYS, CONSENT_VERSION, LIVE_OK_VERSIONS } from "@/lib/config";
import * as heart from "@/lib/heart";
import { loadPersona } from "@/personas/lazy";
import type { Persona } from "@/personas/persona";
import { purgeMinorAndBlock } from "@/lib/minor";
import {
  clearAgeCheck,
  insertConsent,
  markCtxShown,
  markDeeperShown,
  deleteMessage,
  editMessage,
  getMessagesBefore,
  openChat,
  receiveReply,
  requestLiveReply,
  retractReply,
  rpcErrorMessage,
  seedOpener,
  sendMessage,
  LiveReplyError,
  type LiveReply,
} from "@/lib/supabase/queries";
import type { Message, Pressure } from "@/state/schema";
import { ChatHeader } from "@/components/ChatHeader";
import { MessageList } from "@/components/MessageList";
import { Composer, draftKeyFor, type PlansFrom } from "@/components/Composer";
import { PinnedSheet } from "@/components/chat/PinnedSheet";
import { ContextCard } from "@/components/chat/ContextCard";
import { LevelBadge } from "@/components/chat/LevelBadge";
import { useLevelBadge } from "@/components/chat/useLevelBadge";
import { ResourceCard } from "@/components/chat/ResourceCard";
import { AgeCheckSheet } from "@/components/chat/AgeCheckSheet";
import { ConsentUpdateSheet } from "@/components/chat/ConsentUpdateSheet";
import { ScreenFx, type ScreenKind } from "@/components/chat/ScreenFx";
import { MessageActions } from "@/components/chat/MessageActions";
import { QaSheet, type QaForce, type QaPreviewRequest } from "@/components/qa/QaSheet";
import { useQaAccess } from "@/components/qa/useQaAccess";
import { PREVIEW_TEXT, previewId } from "@/components/qa/qaPreview";
import styles from "./page.module.css";

const REACTION_DELAY_MS = 700;
/** A first bubble's typing never shrinks below this, however long the model took. */
const MIN_TYPING_MS = 600;
/** How long to leave paging alone after a failed page load. */
const PAGING_BACKOFF_MS = 5000;
/** Most pages a quote jump walks back through. */
const MAX_JUMP_PAGES = 10;
/** How long to keep asking while another request is still writing her reply (202): past the reply route's maxDuration. */
const PENDING_POLL_MS = 150_000;
const PENDING_POLL_EVERY_MS = 2500;
/** User messages the server answered with silence (an ignored double text); a resume never asks about them again. Survives remounts. */
const answeredSilently = new Set<number>();
const typingMs = (len: number) => Math.min(4500, Math.max(1100, len * 35));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function ChatPage() {
  return (
    <ManifestGate>
      <ChatContent />
    </ManifestGate>
  );
}

function ChatContent() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const auth = useAuth();
  const { openSheet } = useSheet();
  const { templates } = useManifest();
  const showToast = useToast();

  const companion = byId(state, id);
  const locked = companion ? lockedCompanionIds(state.companions, state.entitlement.slotLimit).has(companion.id) : false;
  const template = companion ? templates.find((t) => t.id === companion.templateId) : undefined;
  // The server decides (ally_private.is_live); the client never recomputes it.
  const live = companion?.live === true;
  // Loaded on demand, one file for this face, instead of all 32 personas in the page bundle.
  const [persona, setPersona] = useState<Persona | null>(null);
  const templateIdForPersona = live && companion ? companion.templateId : null;
  useEffect(() => {
    if (!templateIdForPersona) return;
    let alive = true;
    loadPersona(templateIdForPersona).then((p) => alive && setPersona(p)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [templateIdForPersona]);

  const openedRef = useRef(false);
  const seededRef = useRef(false);
  const dividerBeforeAtRef = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const playingRef = useRef(false);
  /** A reply asked for while another was still playing; run once that one ends. */
  const queuedRef = useRef<{ companionId: string; userMessageId?: number } | null>(null);
  // The newest user message the server had seen when it wrote the last reply.
  const lastSeenUpToRef = useRef(0);
  const [typing, setTyping] = useState(false);
  /** A reply is being fetched or played (the ref's twin, so effects can wait for it to end). */
  const [playing, setPlaying] = useState(false);
  /** The id of the newest of the user's messages she has read; the receipt says Read from here on. */
  const [readUpTo, setReadUpTo] = useState<number | null>(null);
  const [showOverflow, setShowOverflow] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const pagingBlockedUntilRef = useRef(0);
  const [jumpTarget, setJumpTarget] = useState<{ id: number; nonce: number } | null>(null);
  const jumpSeqRef = useRef(0);
  /** Strictly ordered sends: each waits for the one before it. */
  const sendChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const [ctxCard, setCtxCard] = useState<{ title?: string; line: string } | null>(null);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [failedMode, setFailedMode] = useState<"reply" | "opener" | null>(null);
  const [screenFx, setScreenFx] = useState<ScreenKind | null>(null);
  const [ageError, setAgeError] = useState(false);
  // Plans: the one-time "deeper level" banner, decided when the chat is opened.
  const [deeperBanner, setDeeperBanner] = useState(false);
  // B3: the message menu, the reply and edit being written.
  const [actionsFor, setActionsFor] = useState<Message | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: number } | null>(null);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  // B3 QA tools. Previews are local bubbles that never reach the server.
  const qaAccess = useQaAccess(auth.user?.id);
  const [qaOpen, setQaOpen] = useState(false);
  const [qaIgnoreCaps, setQaIgnoreCaps] = useState(false);
  const [qaForce, setQaForce] = useState<QaForce | null>(null);
  // A QA jump up to this level: the next reply plays its level-up screen.
  const [qaCelebrate, setQaCelebrate] = useState<number | null>(null);
  const [previews, setPreviews] = useState<Message[]>([]);
  const qaRef = useRef<{ ignoreCaps: boolean; force: QaForce | null; celebrate: number | null }>({ ignoreCaps: false, force: null, celebrate: null });
  qaRef.current = { ignoreCaps: qaAccess.qa && qaIgnoreCaps, force: qaAccess.qa ? qaForce : null, celebrate: qaAccess.qa ? qaCelebrate : null };
  // The message being replied to, as it stands now (a deleted one is no longer a target).
  const replyTarget = replyTo && companion ? (companion.messages.find((m) => m.id === replyTo.id && !m.deleted) ?? null) : null;
  const accountNudgeRef = useRef<number>(0); // last exchange threshold nudged at
  const mountExchangesRef = useRef<number | null>(null);
  // The latest companion and persona for callbacks that outlive a render (paging, sends in the queue).
  const companionRef = useRef(companion);
  companionRef.current = companion;
  const personaRef = useRef(persona);
  personaRef.current = persona;
  // The level badge: one second on every open of a live chat (and on return after 60 s away).
  const levelBadge = useLevelBadge(live && companion ? companion.id : null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // A live chat needs a consent that covers AI-written replies (LIVE_OK_VERSIONS) before anything is sent to the model.
  // The onboarding consent covers it; only a user whose newest consent is the September one sees the update sheet.
  const needsConsent = live && !LIVE_OK_VERSIONS.includes(state.user.consentVersion ?? "");

  // Capture the pre-open lastOpenedAt for the "Since you left" divider
  // BEFORE dispatching OPEN_CHAT, which overwrites it. The same value drives
  // whether the context card shows.
  useEffect(() => {
    if (!companion || openedRef.current) return;
    openedRef.current = true;
    // Never on the very-first-ever open (fresh lock, no messages yet) —
    // otherwise the opener we're about to seed reads as "since you left"
    // before the user has seen a single message.
    const isFirstOpenEver = companion.messages.length === 0 && !companion.hasMore && companion.lastOpenedAt === companion.createdAt;
    dividerBeforeAtRef.current = isFirstOpenEver ? null : companion.lastOpenedAt;
    const companionId = companion.id;

    // The stored trust is past this plan's ceiling: say so once for this companion. Its row on the plans screen stays.
    if (companion.deeperLevelAvailable && !companion.deeperShown) {
      setDeeperBanner(true);
      markDeeperShown(companionId)
        .then(() => dispatch({ type: "LIVE_SYNC", companionId, patch: { deeperShown: true } }))
        .catch(() => {});
    }

    if (companion.live) {
      const t = now();
      const levelChanged = (companion.levelChangedAt ?? 0) > companion.lastOpenedAt;
      const stale = t - companion.lastOpenedAt >= 3 * 3600 * 1000;
      if (companion.lastCtxDay !== dayKey(t) || stale || levelChanged) {
        const snapshot = companion;
        loadPersona(snapshot.templateId)
          .then((persona) => {
            const h = heart.now(snapshot, t, persona);
            const key = heart.contextCardKey(h.block, h.mood, levelChanged, persona);
            setCtxCard({
              title: levelChanged ? persona.levels[Math.max(0, (snapshot.trustLevel ?? 1) - 1)]?.name : undefined,
              line: persona.contextCards[key] ?? persona.contextCards[h.block.card],
            });
            return markCtxShown(companionId).then(() => dispatch({ type: "LIVE_SYNC", companionId, patch: { lastCtxDay: dayKey(t) } }));
          })
          .catch(() => {});
      }
    }

    openChat(companionId)
      .then(({ lastOpenedAt }) => dispatch({ type: "OPEN_CHAT", companionId, lastOpenedAt }))
      .catch((e) => showToast(rpcErrorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion?.id]);

  // Plays a live reply: the reaction after 700 ms, typing dots then each
  // bubble, then any screen effect. The bubbles already exist server-side, so
  // a refresh mid-play just shows them. If the chat is left mid-play the rest
  // go into the app state at once (the chat list and the next open have them),
  // and a bubble the state already holds (caught up by a resync) is not typed again.
  const play = useCallback(
    async (companionId: string, userMessageId: number | undefined, r: LiveReply, timing: { readAt: number; typingCredit: number }) => {
      if (r.reaction && userMessageId !== undefined) {
        const reaction = r.reaction;
        // The tapback lands 700 ms after the message was marked read, never before.
        // Lands in the app state even if the chat has been left by then.
        setTimeout(() => dispatch({ type: "SET_REACTION", companionId, messageId: userMessageId, reaction }), Math.max(0, timing.readAt + REACTION_DELAY_MS - Date.now()));
      }
      let first = true;
      const toMessage = (b: LiveReply["bubbles"][number]): Message => ({ id: b.id, who: "them", text: b.text, at: b.at, meta: b.meta, inReplyTo: userMessageId ?? null });
      for (const b of r.bubbles) {
        if (companionRef.current?.messages.some((m) => m.id === b.id)) continue;
        if (!aliveRef.current) {
          dispatch({ type: "RECEIVE_REPLY", companionId, message: toMessage(b) });
          continue;
        }
        setTyping(true);
        if (b.meta?.effect === "stop") {
          await sleep(1800);
          setTyping(false);
          await sleep(900);
          setTyping(true);
          await sleep(900);
        } else {
          // The dots have already been showing since she read it: take that time off the first bubble.
          const wait = first ? Math.max(MIN_TYPING_MS, typingMs(b.text.length) - timing.typingCredit) : typingMs(b.text.length);
          await sleep(wait);
        }
        first = false;
        if (aliveRef.current) setTyping(false);
        dispatch({ type: "RECEIVE_REPLY", companionId, message: toMessage(b) });
      }
      dispatch({
        type: "LIVE_SYNC",
        companionId,
        patch: {
          trustLevel: r.trustLevel,
          ...(r.deeperLevelAvailable !== undefined ? { deeperLevelAvailable: r.deeperLevelAvailable } : {}),
          ...(r.paused ? { pausedReason: "age_check" as const } : {}),
        },
      });
      if (!aliveRef.current) return;
      if (r.resourceCard) setResourceOpen(true);
      if (r.screen) setScreenFx(r.screen);
    },
    [dispatch]
  );

  // Asks the server for the companion's reply (or opener), then plays it. 202 means one
  // is already in flight (a second tab): try again shortly.
  // `readDelay` is how long she takes to read the user's message first (null for an opener). The request goes
  // out at once, in parallel: the receipt turns to Read and the dots start when the delay is up, and the first
  // bubble's typing time is cut by however long the dots have already been showing.
  // The request is sent and finished even if the chat is left meanwhile: the server writes the reply either way,
  // and play() puts it in the app state. `resume` picks up a reply for a message sent on an earlier visit: no
  // read delay, and the dots only while another request is still writing it.
  const fetchAndPlay = useCallback(
    async (companionId: string, mode: "reply" | "opener", userMessageId?: number, followUp = false, readDelay: number | null = null, resume = false) => {
      if (playingRef.current) {
        // The user sent again while the companion was mid-reply: answer that message next
        // (the server prompt covers both), rather than dropping it.
        if (mode === "reply") queuedRef.current = { companionId, userMessageId };
        return;
      }
      playingRef.current = true;
      setPlaying(true);
      setFailedMode(null);
      const startedAt = Date.now();
      const withRead = mode === "reply" && userMessageId !== undefined;
      // A queued follow-up is read on the free tier.
      const delay = withRead && !resume ? (followUp ? readDelayMs("free", Math.random()) : (readDelay ?? 0)) : 0;
      let readAt = startedAt;
      let settled = false;
      // A dequeued follow-up may end up a tapback alone: play() shows the dots per bubble, so none while waiting.
      if (!withRead && !followUp && !resume) setTyping(true);
      const readDone: Promise<void> = withRead
        ? sleep(delay).then(() => {
            if (!aliveRef.current) return;
            readAt = Date.now();
            setReadUpTo((prev) => Math.max(prev ?? 0, userMessageId as number));
            if (!settled && !followUp && !resume) setTyping(true);
          })
        : Promise.resolve();
      try {
        const opts = qaRef.current;
        const qaBody = opts.ignoreCaps || opts.force || opts.celebrate ? { ignoreCaps: opts.ignoreCaps, force: opts.force, celebrate: opts.celebrate } : null;
        // 202: another request (an earlier visit, a second tab) is still writing it. Keep asking until it lands;
        // the server takes the claim over once the request holding it has run past its time limit.
        const fetchReply = async (): Promise<LiveReply | null> => {
          const until = Date.now() + PENDING_POLL_MS;
          for (;;) {
            const got = await requestLiveReply(companionId, mode, qaBody);
            if (got || Date.now() >= until) return got;
            if (resume && aliveRef.current && !settled) setTyping(true);
            await sleep(PENDING_POLL_EVERY_MS);
          }
        };
        const arrival = { at: startedAt };
        const [r] = await Promise.all([fetchReply().then((got) => ((arrival.at = Date.now()), got)), readDone]);
        // "Next reply" means one reply: the forced effects are spent once it has come back.
        if (r && opts.force) setQaForce(null);
        if (r && opts.celebrate) setQaCelebrate(null);
        setTyping(false);
        if (r?.seenUpTo != null) lastSeenUpToRef.current = r.seenUpTo;
        if (r && mode === "reply" && userMessageId !== undefined && !r.reaction && r.bubbles.length === 0) answeredSilently.add(userMessageId);
        const typingCredit = withRead ? Math.max(0, arrival.at - startedAt - delay) : 0;
        if (r) await play(companionId, userMessageId, r, { readAt, typingCredit });
      } catch (e) {
        setTyping(false);
        if (e instanceof LiveReplyError && e.status === 423) {
          dispatch({ type: "LIVE_SYNC", companionId, patch: { pausedReason: "age_check" } });
        } else if (!resume) {
          // A resume that fails stays quiet: the next open or return to the app asks again.
          setFailedMode(mode);
        }
      } finally {
        settled = true;
        playingRef.current = false;
        setPlaying(false);
        const next = queuedRef.current;
        queuedRef.current = null;
        // The reply just played already saw the queued message: nothing left to ask for.
        // Asked for even if the chat has been left, so a double text sent just before leaving is still answered.
        const covered = next && next.userMessageId !== undefined && lastSeenUpToRef.current >= next.userMessageId;
        if (next && !covered) void fetchAndPlay(next.companionId, "reply", next.userMessageId, true);
      }
    },
    [dispatch, play]
  );

  // How long she takes to read a message sent right now: from the block she is in (free, busy, or asleep).
  const readDelayNow = useCallback((): number => {
    const c = companionRef.current;
    const p = personaRef.current;
    if (!c || !c.live || !p) return readDelayMs("free", Math.random());
    return readDelayMs(tierFor(heart.now(c, now(), p), p), Math.random());
  }, []);

  // ---- history paging ------------------------------------------------------
  const loadOlder = useCallback(async () => {
    const c = companionRef.current;
    if (!c || !c.hasMore || loadingOlderRef.current || Date.now() < pagingBlockedUntilRef.current) return;
    const oldest = c.messages.find(isSaved)?.id;
    if (oldest === undefined) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await getMessagesBefore(c.id, oldest);
      if (aliveRef.current) dispatch({ type: "PREPEND_MESSAGES", companionId: c.id, messages: page.messages, hasMore: page.hasMore });
    } catch (e) {
      pagingBlockedUntilRef.current = Date.now() + PAGING_BACKOFF_MS;
      showToast(rpcErrorMessage(e));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [dispatch, showToast]);

  // Scrolls to a message and flashes it, paging backwards (up to ten pages) if it is not loaded yet.
  const jumpToMessage = useCallback(
    async (id: number) => {
      const c = companionRef.current;
      if (!c) return;
      const target = () => setJumpTarget({ id, nonce: ++jumpSeqRef.current });
      if (c.messages.some((m) => m.id === id)) {
        target();
        return;
      }
      if (loadingOlderRef.current) return;
      let oldest = c.messages.find(isSaved)?.id;
      let more = c.hasMore === true;
      loadingOlderRef.current = true;
      setLoadingOlder(true);
      try {
        for (let page = 0; page < MAX_JUMP_PAGES && more && oldest !== undefined; page++) {
          const r = await getMessagesBefore(c.id, oldest);
          if (!aliveRef.current) return;
          dispatch({ type: "PREPEND_MESSAGES", companionId: c.id, messages: r.messages, hasMore: r.hasMore });
          more = r.hasMore;
          if (r.messages.some((m) => m.id === id)) {
            target();
            return;
          }
          oldest = r.messages[0]?.id;
        }
        showToast(COPY.chat.messageGone);
      } catch (e) {
        showToast(rpcErrorMessage(e));
      } finally {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      }
    },
    [dispatch, showToast]
  );

  // CONFIRM_LOCK creates a companion with messages: []. Seed the opener
  // the first time this chat is ever opened. seed_opener only writes into
  // an empty conversation, so a second tab can't post a second opener.
  // A live companion's opener is written by the server instead.
  useEffect(() => {
    if (!companion || seededRef.current) return;
    if (companion.messages.length > 0 || companion.hasMore) return;
    if (!companion.core.primary) return;
    if (live) {
      // A paused companion (expired plan, or outside the plan's slots) takes no new messages, so no opener either.
      if (needsConsent || locked || state.entitlement.plan === "expired") return;
      seededRef.current = true;
      void fetchAndPlay(companion.id, "opener");
      return;
    }
    // No opener while the name is blank: it would go out saying "!".
    if (!state.user.displayName.trim()) return;
    seededRef.current = true;
    const companionId = companion.id;
    const pressure: Pressure = companion.answers.q10 ?? "head";
    const text = openerFor(companion.core.primary, pressure, state.user.displayName);
    seedOpener(companionId, text)
      .then(({ message }) => {
        if (message) dispatch({ type: "SEED_OPENER", companionId, message });
      })
      .catch((e) => {
        seededRef.current = false;
        showToast(rpcErrorMessage(e));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion?.id, companion?.messages.length, live, needsConsent, locked, state.entitlement.plan, state.user.consentVersion, state.user.displayName]);

  // Catch-up, on open and on every return to the app: pull the newest page from the server. Bubbles written
  // while this chat was off screen (left mid-reply, or the app closed) show up, and a message of the user's that
  // still has no reply is asked about again: the server replays a finished reply, waits on the request still
  // writing it (taking it over if that request died), or writes it now.
  const companionIdForSync = live && companion ? companion.id : null;
  const canResumeRef = useRef(false);
  canResumeRef.current = live && !needsConsent && !locked && state.entitlement.plan !== "expired" && !companion?.pausedReason;
  useEffect(() => {
    if (!companionIdForSync) return;
    const cid = companionIdForSync;
    let busy = false;
    const sync = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const page = await getMessagesBefore(cid, Number.MAX_SAFE_INTEGER);
        if (!aliveRef.current) return;
        dispatch({ type: "MERGE_LATEST", companionId: cid, messages: page.messages });
        const newest = [...page.messages].reverse().find((m) => !m.deleted);
        const unanswered = newest && newest.who === "me" && typeof newest.id === "number" && !newest.meta?.reaction ? newest.id : null;
        if (unanswered !== null && !answeredSilently.has(unanswered) && canResumeRef.current && !playingRef.current) void fetchAndPlay(cid, "reply", unanswered, false, 0, true);
      } catch {
        // The next open or return to the app tries again.
      } finally {
        busy = false;
      }
    };
    void sync();
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [companionIdForSync, dispatch, fetchAndPlay]);

  // Account sheet nudge, spec §8.1's exchange-count rule applied to THIS
  // chat's companion (the spec says `companions[0].exchanges`, a slip for "the
  // current companion"). The first chat is left alone: the sheet opens at
  // exchange 3 (dismissible) and 7 (blocking), and only once her reply to that
  // exchange has landed and nothing is typing or playing. Each threshold fires
  // once per mount; the third only for an exchange made during this visit.
  const lastMsg = companion?.messages[companion.messages.length - 1];
  const replyLanded = lastMsg?.who === "them" && !lastMsg.pending && !typing && !playing;
  useEffect(() => {
    if (!companion || !template || state.user.accountAt) return;
    const n = companion.exchanges;
    if (mountExchangesRef.current === null) mountExchangesRef.current = n;
    if (!replyLanded) return;
    const personaName = firstNameFromFull(template.name);
    if (n >= 7 && accountNudgeRef.current < 7) {
      accountNudgeRef.current = 7;
      openSheet("account", { personaName, exchanges: n, blocking: true });
    } else if (n >= 3 && n < 7 && n > mountExchangesRef.current && accountNudgeRef.current < 3) {
      accountNudgeRef.current = 3;
      openSheet("account", { personaName, exchanges: n });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion?.exchanges, replyLanded, state.user.accountAt, template]);

  // The overflow menu closes on Escape.
  useEffect(() => {
    if (!showOverflow) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowOverflow(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showOverflow]);

  if (!companion || !template) {
    return <div className={styles.notFound}>Not found.</div>;
  }

  // The bubble appears at once, as a pending message. send_message checks and
  // debits the ledger server-side in one transaction, and the message and ledger
  // shown are the ones it returns; a refusal or failure takes the bubble away and
  // resolves false so the composer gives the text back. Sends go out in order.
  // Non-live companions still get their reply text from replyFor() here,
  // stored server-side; a live companion's reply is written by the server.
  function handleSend(text: string): Promise<boolean> {
    const companionId = companion!.id;
    const primary = companion!.core.primary;
    const isLive = live;
    const quoteId = replyTarget?.id;
    const tempId = nextTempId();
    dispatch({
      type: "ADD_PENDING",
      companionId,
      message: { id: tempId, clientKey: tempId, who: "me", text, at: now(), pending: true, ...(quoteId !== undefined ? { meta: { quoteId } } : {}) },
    });
    setReplyTo(null);

    async function deliver(): Promise<boolean> {
      let res;
      try {
        res = await sendMessage(companionId, text, quoteId);
      } catch (e) {
        dispatch({ type: "DROP_PENDING", companionId, tempId });
        if ((e as { message?: string })?.message !== "quote_not_found" && quoteId !== undefined) setReplyTo((cur) => cur ?? { id: quoteId });
        showToast(rpcErrorMessage(e));
        return false;
      }
      if (res.blocked || !res.message) {
        // Refused server-side (TRIAL_LIMIT, PLAN_EXPIRED, FAIR_USE_CAP or COMPANION_LOCKED): the fresh
        // entitlement makes the composer show the matching bar.
        dispatch({ type: "DROP_PENDING", companionId, tempId });
        dispatch({ type: "LEDGER_SYNC", ledger: res.ledger, entitlement: res.entitlement });
        if (!isSendCode(res.status)) showToast(COPY.auth.network);
        return false;
      }
      const sent = res.message;
      dispatch({ type: "CONFIRM_SENT", companionId, tempId, message: sent, exchanges: res.exchanges, ledger: res.ledger, entitlement: res.entitlement });
      if (isLive) {
        void fetchAndPlay(companionId, "reply", sent.id, false, readDelayNow());
        return true;
      }
      if (!primary) return true;
      const reply = replyFor(primary, res.exchanges);
      // A mock companion reads on the free tier, then types for a moment.
      const readDelay = readDelayMs("free", Math.random());
      const typeFor = 1200 + Math.random() * 600;
      setTimeout(() => {
        if (!aliveRef.current) return;
        if (typeof sent.id === "number") setReadUpTo((prev) => Math.max(prev ?? 0, sent.id as number));
        setTyping(true);
      }, readDelay);
      setTimeout(() => {
        receiveReply(companionId, reply)
          .then(({ message }) => dispatch({ type: "RECEIVE_REPLY", companionId, message }))
          .catch((e) => showToast(rpcErrorMessage(e)))
          .finally(() => setTyping(false));
      }, readDelay + typeFor);
      return true;
    }

    const run = sendChainRef.current.then(deliver);
    sendChainRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function retry() {
    const c = companion!;
    if (c.messages.length === 0 && !c.hasMore) {
      void fetchAndPlay(c.id, "opener");
      return;
    }
    const lastMe = [...c.messages].reverse().find((m) => m.who === "me");
    void fetchAndPlay(c.id, "reply", lastMe?.id, false, 0);
  }

  // ---- B3: message actions -------------------------------------------------
  function openActions(m: Message) {
    if (typeof m.id === "number" && m.id > 0) setActionsFor(m);
  }

  function startReply(m: Message) {
    if (typeof m.id !== "number" || m.id <= 0) return;
    setActionsFor(null);
    setEditing(null);
    setReplyTo({ id: m.id });
  }

  function startEdit(m: Message) {
    if (typeof m.id !== "number") return;
    setActionsFor(null);
    setReplyTo(null);
    setEditing({ id: m.id, text: m.text });
  }

  async function saveEdit(text: string) {
    const target = editing;
    setEditing(null);
    if (!target || text === target.text) return;
    const companionId = companion!.id;
    try {
      const r = await editMessage(companionId, target.id, text);
      dispatch({ type: "REPLACE_MESSAGE", companionId, message: r.message });
    } catch (e) {
      showToast(rpcErrorMessage(e));
      return;
    }
    // Editing the newest answered message has her answer it again. The server decides (retract_reply);
    // when it declines (not_latest, not_allowed) the edit simply stands.
    const c = companionRef.current;
    if (!c || !canRegenerate(c.messages, target.id, { live: c.live === true, locked, expired: state.entitlement.plan === "expired", playing: playingRef.current })) return;
    try {
      const r = await retractReply(companionId, target.id);
      dispatch({ type: "REMOVE_MESSAGES", companionId, ids: r.removedIds });
      dispatch({ type: "REPLACE_MESSAGE", companionId, message: r.message });
      setReadUpTo((prev) => (prev !== null && prev >= target.id ? target.id - 1 : prev));
      void fetchAndPlay(companionId, "reply", target.id, false, readDelayNow());
    } catch {
      /* the edit stands */
    }
  }

  async function removeMessage(m: Message) {
    setActionsFor(null);
    if (typeof m.id !== "number") return;
    try {
      const r = await deleteMessage(companion!.id, m.id);
      dispatch({ type: "REPLACE_MESSAGE", companionId: companion!.id, message: r.message });
      if (replyTo?.id === m.id) setReplyTo(null);
      if (editing?.id === m.id) setEditing(null);
    } catch (e) {
      showToast(rpcErrorMessage(e));
    }
  }

  function copyMessage(m: Message) {
    setActionsFor(null);
    navigator.clipboard
      ?.writeText(m.text)
      .then(() => showToast(COPY.chat.copied))
      .catch(() => {});
  }

  // ---- B3: QA effect previews (local bubbles, nothing is sent) -------------
  function runPreview(p: QaPreviewRequest) {
    if (p.screen) {
      setScreenFx(p.screen as ScreenKind);
      return;
    }
    if (p.reaction) {
      const id = previewId();
      const reaction = p.reaction;
      setPreviews((x) => [...x, { id, who: "me", text: "a message of mine, for the preview", at: Date.now() }]);
      setTimeout(() => setPreviews((x) => x.map((m) => (m.id === id ? { ...m, meta: { reaction } } : m))), REACTION_DELAY_MS);
      return;
    }
    const effect = p.effect;
    if (!effect) return;
    const add = () => setPreviews((x) => [...x, { id: previewId(), who: "them", text: PREVIEW_TEXT[effect], at: Date.now(), meta: { effect } }]);
    if (effect === "stop") {
      setTyping(true);
      void sleep(1800)
        .then(() => setTyping(false))
        .then(() => sleep(900))
        .then(() => {
          setTyping(true);
          return sleep(900);
        })
        .then(() => {
          setTyping(false);
          add();
        });
      return;
    }
    add();
  }

  async function onConsentContinue() {
    const uid = auth.user?.id;
    if (!uid) return;
    try {
      await insertConsent(uid, CONSENT_VERSION);
      dispatch({ type: "SET_CONSENT_VERSION", version: CONSENT_VERSION });
    } catch (e) {
      showToast(rpcErrorMessage(e));
    }
  }

  async function onAgeAdult(dob: string) {
    setAgeError(false);
    try {
      await clearAgeCheck(companion!.id, dob);
      dispatch({ type: "LIVE_SYNC", companionId: companion!.id, patch: { pausedReason: null } });
    } catch (e) {
      // under_18 from the server: run the blocked flow like the birthday screen does.
      if ((e as { message?: string })?.message === "under_18") {
        await onAgeUnder18();
        return;
      }
      setAgeError(true);
    }
  }

  async function onAgeUnder18() {
    await purgeMinorAndBlock(auth.user?.id ?? null, now() + BLOCK_DAYS * 86400000);
    router.replace("/blocked");
  }

  // What the composer shows comes from the entitlement the server sent, never from the device clock.
  const variant = composerGate(state.entitlement, locked);

  const firstName = firstNameFromFull(template.name);
  const paused = companion.pausedReason === "age_check";
  const presenceOverride = live && persona ? heart.now(companion, now(), persona).block.presence : undefined;

  return (
    <div className={styles.page}>
      <ChatHeader
        template={template}
        onBack={() => router.push("/home")}
        onOpenProfile={() => router.push(`/profile/${companion.id}`)}
        onLongPressAvatar={() => openSheet("switcher", { currentId: companion.id })}
        onOverflow={() => setShowOverflow((v) => !v)}
        overflowOpen={showOverflow}
        presenceOverride={presenceOverride}
        onQa={qaAccess.qa && live ? () => setQaOpen(true) : undefined}
      />
      {levelBadge && persona && <LevelBadge name={persona.levels[Math.min(5, Math.max(0, (companion.trustLevel ?? 1) - 1))].name} level={companion.trustLevel ?? 1} />}
      {/* The badge goes first; a due context card waits until it has gone. */}
      {ctxCard && !levelBadge && <ContextCard title={ctxCard.title} line={ctxCard.line} onGone={() => setCtxCard(null)} />}
      {deeperBanner && (
        <div className={styles.deeper} role="status" data-testid="deeper-banner">
          <button type="button" className={styles.deeperLink} onClick={() => router.push("/plans?from=deep")}>
            {fill(COPY.chat.deeperBanner, { name: firstName })}
          </button>
          <button type="button" className={styles.deeperClose} aria-label={COPY.plans.close} onClick={() => setDeeperBanner(false)}>
            ×
          </button>
        </div>
      )}
      {showOverflow && (
        <>
          <div className={styles.overflowBackdrop} data-testid="overflow-backdrop" onClick={() => setShowOverflow(false)} />
          <div className={styles.overflowMenu} role="menu">
            {state.companions.filter((c) => c.status === "active").length > 1 && (
              <button
                type="button"
                role="menuitem"
                className={styles.overflowRow}
                onClick={() => {
                  setShowOverflow(false);
                  openSheet("switcher", { currentId: companion.id });
                }}
              >
                {COPY.chat.overflowSwitch}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className={styles.overflowRow}
              onClick={() => {
                setShowOverflow(false);
                setPinsOpen(true);
              }}
            >
              {COPY.chat.overflowPins}
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.overflowRow}
              onClick={() => {
                setShowOverflow(false);
                router.push(`/profile/${companion.id}`);
              }}
            >
              {COPY.chat.overflowProfile}
            </button>
          </div>
        </>
      )}
      <MessageList
        messages={previews.length ? [...companion.messages, ...previews] : companion.messages}
        personaName={firstName}
        onOpenActions={openActions}
        onReply={startReply}
        dividerBeforeAt={dividerBeforeAtRef.current}
        typing={typing}
        readUpTo={readUpTo}
        hasMore={companion.hasMore === true}
        loadingOlder={loadingOlder}
        onLoadOlder={() => void loadOlder()}
        jumpTarget={jumpTarget}
        onQuoteJump={(qid) => void jumpToMessage(qid)}
        companionColor={template.palette}
        footer={live && resourceOpen ? <ResourceCard onDismiss={() => setResourceOpen(false)} /> : undefined}
        onRetry={failedMode ? retry : null}
      />
      {!paused && (
        <Composer
          variant={variant}
          onSend={handleSend}
          draftKey={auth.user?.id ? draftKeyFor(auth.user.id, companion.id) : null}
          onOpenPlans={(from: PlansFrom) => router.push(`/plans?from=${from}`)}
          replyingTo={replyTarget ? { label: replyTarget.who === "me" ? COPY.chat.quoteYou : firstName, text: replyTarget.text } : null}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onSaveEdit={(text) => void saveEdit(text)}
          onCancelEdit={() => setEditing(null)}
        />
      )}
      {actionsFor && (
        <MessageActions
          message={actionsFor}
          nowMs={Date.now()}
          onReply={() => startReply(actionsFor)}
          onCopy={() => copyMessage(actionsFor)}
          onEdit={() => startEdit(actionsFor)}
          onDelete={() => void removeMessage(actionsFor)}
          onClose={() => setActionsFor(null)}
        />
      )}
      {qaOpen && qaAccess.qa && live && persona && (
        <QaSheet
          companionId={companion.id}
          persona={persona}
          activeCompanions={state.companions.filter((c) => c.status === "active")}
          level={companion.trustLevel ?? 1}
          admin={qaAccess.admin}
          ignoreCaps={qaIgnoreCaps}
          force={qaForce}
          onIgnoreCaps={setQaIgnoreCaps}
          onForce={setQaForce}
          onPreview={runPreview}
          onLevel={(trustLevel, levelChangedAt) => {
            setQaCelebrate(trustLevel > (companion.trustLevel ?? 1) ? trustLevel : null);
            dispatch({ type: "LIVE_SYNC", companionId: companion.id, patch: { trustLevel, levelChangedAt } });
          }}
          onLedger={(ledger, entitlement) => dispatch({ type: "LEDGER_SYNC", ledger, entitlement })}
          onAdded={(c) => dispatch({ type: "ADD_COMPANION", companion: c })}
          onClose={() => setQaOpen(false)}
          onToast={showToast}
        />
      )}
      {paused && <AgeCheckSheet error={ageError} onAdult={(dob) => void onAgeAdult(dob)} onUnder18={() => void onAgeUnder18()} />}
      {needsConsent && <ConsentUpdateSheet persona={firstName} obj={pronounsFor(template).obj} onContinue={() => void onConsentContinue()} onNotNow={() => router.push("/home")} />}
      {pinsOpen && <PinnedSheet companionId={companion.id} onClose={() => setPinsOpen(false)} onJump={(pid) => void jumpToMessage(pid)} onError={showToast} />}
      {screenFx && <ScreenFx kind={screenFx} onDone={() => setScreenFx(null)} />}
    </div>
  );
}
