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
import { canSend, freeLeft, passActive } from "@/lib/ledger";
import { openerFor, replyFor, COPY } from "@/lib/copy";
import { firstNameFromFull } from "@/lib/engine";
import { dayKey, now, serverNow } from "@/lib/clock";
import { BLOCK_DAYS, LIVE_CONSENT_VERSION } from "@/lib/config";
import { isLive } from "@/lib/live";
import * as heart from "@/lib/heart";
import { F01 } from "@/personas/persona";
import { purgeMinorAndBlock } from "@/lib/minor";
import {
  clearAgeCheck,
  insertConsent,
  markCtxShown,
  openChat,
  receiveReply,
  requestLiveReply,
  rpcErrorMessage,
  seedOpener,
  sendMessage,
  LiveReplyError,
  type LiveReply,
} from "@/lib/supabase/queries";
import type { Pressure } from "@/state/schema";
import { ChatHeader } from "@/components/ChatHeader";
import { MessageList } from "@/components/MessageList";
import { Composer, type ComposerVariant } from "@/components/Composer";
import { ContextCard } from "@/components/chat/ContextCard";
import { ResourceCard } from "@/components/chat/ResourceCard";
import { AgeCheckSheet } from "@/components/chat/AgeCheckSheet";
import { ConsentUpdateSheet } from "@/components/chat/ConsentUpdateSheet";
import { ScreenFx, type ScreenKind } from "@/components/chat/ScreenFx";
import styles from "./page.module.css";

const REACTION_DELAY_MS = 700;
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
  const template = companion ? templates.find((t) => t.id === companion.templateId) : undefined;
  const live = companion ? isLive(companion) : false;

  const openedRef = useRef(false);
  const seededRef = useRef(false);
  const dividerBeforeAtRef = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const playingRef = useRef(false);
  /** A reply asked for while another was still playing; run once that one ends. */
  const queuedRef = useRef<{ companionId: string; userMessageId?: number } | null>(null);
  const [typing, setTyping] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [ctxCard, setCtxCard] = useState<{ title?: string; line: string } | null>(null);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [failedMode, setFailedMode] = useState<"reply" | "opener" | null>(null);
  const [screenFx, setScreenFx] = useState<ScreenKind | null>(null);
  const [ageError, setAgeError] = useState(false);
  const accountNudgeRef = useRef<number>(0); // last exchange threshold nudged at

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // A live chat needs the v2-live consent (v2-live-groq) before anything is sent to the model.
  // A user who has not been hydrated from the server (a fresh onboarding) has no known version, so they consent here too.
  const needsConsent = live && state.user.consentVersion !== LIVE_CONSENT_VERSION;

  // Capture the pre-open lastOpenedAt for the "Since you left" divider
  // BEFORE dispatching OPEN_CHAT, which overwrites it. The same value drives
  // whether the context card shows.
  useEffect(() => {
    if (!companion || openedRef.current) return;
    openedRef.current = true;
    // Never on the very-first-ever open (fresh lock, no messages yet) —
    // otherwise the opener we're about to seed reads as "since you left"
    // before the user has seen a single message.
    const isFirstOpenEver = companion.messages.length === 0 && companion.lastOpenedAt === companion.createdAt;
    dividerBeforeAtRef.current = isFirstOpenEver ? null : companion.lastOpenedAt;
    const companionId = companion.id;

    if (isLive(companion)) {
      const t = now();
      const levelChanged = (companion.levelChangedAt ?? 0) > companion.lastOpenedAt;
      const stale = t - companion.lastOpenedAt >= 3 * 3600 * 1000;
      if (companion.lastCtxDay !== dayKey(t) || stale || levelChanged) {
        const h = heart.now(companion, t);
        const key = heart.contextCardKey(h.block, h.mood, levelChanged);
        setCtxCard({
          title: levelChanged ? F01.levels[Math.max(0, (companion.trustLevel ?? 1) - 1)]?.name : undefined,
          line: F01.contextCards[key] ?? F01.contextCards[h.block.card],
        });
        markCtxShown(companionId)
          .then(() => dispatch({ type: "LIVE_SYNC", companionId, patch: { lastCtxDay: dayKey(t) } }))
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
  // a refresh mid-play just shows them.
  const play = useCallback(
    async (companionId: string, userMessageId: number | undefined, r: LiveReply) => {
      if (r.reaction && userMessageId !== undefined) {
        const reaction = r.reaction;
        setTimeout(() => {
          if (aliveRef.current) dispatch({ type: "SET_REACTION", companionId, messageId: userMessageId, reaction });
        }, REACTION_DELAY_MS);
      }
      for (const b of r.bubbles) {
        if (!aliveRef.current) return;
        setTyping(true);
        if (b.meta?.effect === "stop") {
          await sleep(1800);
          setTyping(false);
          await sleep(900);
          setTyping(true);
          await sleep(900);
        } else {
          await sleep(typingMs(b.text.length));
        }
        if (!aliveRef.current) return;
        setTyping(false);
        dispatch({ type: "RECEIVE_REPLY", companionId, message: { id: b.id, who: "them", text: b.text, at: b.at, meta: b.meta } });
      }
      dispatch({
        type: "LIVE_SYNC",
        companionId,
        patch: { trustLevel: r.trustLevel, ...(r.paused ? { pausedReason: "age_check" as const } : {}) },
      });
      if (r.resourceCard) setResourceOpen(true);
      if (r.screen && aliveRef.current) setScreenFx(r.screen);
    },
    [dispatch]
  );

  // Asks the server for Ira's reply (or opener), then plays it. 202 means one
  // is already in flight (a second tab): try again shortly.
  const fetchAndPlay = useCallback(
    async (companionId: string, mode: "reply" | "opener", userMessageId?: number) => {
      if (playingRef.current) {
        // The user sent again while Ira was mid-reply: answer that message next
        // (the server prompt covers both), rather than dropping it.
        if (mode === "reply") queuedRef.current = { companionId, userMessageId };
        return;
      }
      playingRef.current = true;
      setFailedMode(null);
      setTyping(true);
      try {
        let r: LiveReply | null = null;
        for (let i = 0; i < 6 && !r && aliveRef.current; i++) {
          r = await requestLiveReply(companionId, mode);
          if (!r) await sleep(2000);
        }
        setTyping(false);
        if (r) await play(companionId, userMessageId, r);
      } catch (e) {
        setTyping(false);
        if (e instanceof LiveReplyError && e.status === 423) {
          dispatch({ type: "LIVE_SYNC", companionId, patch: { pausedReason: "age_check" } });
        } else {
          setFailedMode(mode);
        }
      } finally {
        playingRef.current = false;
        const next = queuedRef.current;
        queuedRef.current = null;
        if (next && aliveRef.current) void fetchAndPlay(next.companionId, "reply", next.userMessageId);
      }
    },
    [dispatch, play]
  );

  // CONFIRM_LOCK creates a companion with messages: []. Seed the opener
  // the first time this chat is ever opened. seed_opener only writes into
  // an empty conversation, so a second tab can't post a second opener.
  // A live companion's opener is written by the server instead.
  useEffect(() => {
    if (!companion || seededRef.current) return;
    if (companion.messages.length > 0) return;
    if (!companion.core.primary) return;
    if (live) {
      if (needsConsent) return;
      seededRef.current = true;
      void fetchAndPlay(companion.id, "opener");
      return;
    }
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
  }, [companion?.id, companion?.messages.length, live, needsConsent, state.user.consentVersion]);

  // Account sheet nudge, spec §8.1's exchange-count rule applied to THIS
  // chat's companion (see report — the spec literally says
  // `companions[0].exchanges`, almost certainly a slip for "the current
  // companion", since a round-two companion would otherwise never trigger
  // its own nudge).
  useEffect(() => {
    if (!companion || !template || state.user.accountAt) return;
    const n = companion.exchanges;
    const personaName = firstNameFromFull(template.name);
    if (n >= 7 && accountNudgeRef.current < 7) {
      accountNudgeRef.current = 7;
      openSheet("account", { personaName, exchanges: n, blocking: true });
    } else if (n === 3 && accountNudgeRef.current < 3) {
      accountNudgeRef.current = 3;
      openSheet("account", { personaName, exchanges: n });
    } else if (n === 1 && accountNudgeRef.current < 1) {
      accountNudgeRef.current = 1;
      openSheet("account", { personaName, exchanges: n });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion?.exchanges, state.user.accountAt, template]);

  if (!companion || !template) {
    return <div className={styles.notFound}>Not found.</div>;
  }

  // send_message checks and debits the ledger server-side in one
  // transaction; the message and ledger shown are the ones it returns.
  // Non-live companions still get their reply text from replyFor() here,
  // stored server-side; a live companion's reply is written by the server.
  async function handleSend(text: string) {
    const companionId = companion!.id;
    const primary = companion!.core.primary;
    let res;
    try {
      res = await sendMessage(companionId, text);
    } catch (e) {
      showToast(rpcErrorMessage(e));
      return;
    }
    if (res.blocked || !res.message) {
      // Out of messages server-side: show the matching bar or paywall state.
      dispatch({ type: "LEDGER_SYNC", ledger: res.ledger });
      return;
    }
    dispatch({ type: "SEND_MESSAGE", companionId, message: res.message, exchanges: res.exchanges, ledger: res.ledger });
    if (live) {
      void fetchAndPlay(companionId, "reply", res.message.id);
      return;
    }
    if (!primary) return;
    const reply = replyFor(primary, res.exchanges);
    setTyping(true);
    const delay = 1200 + Math.random() * 600;
    setTimeout(() => {
      receiveReply(companionId, reply)
        .then(({ message }) => dispatch({ type: "RECEIVE_REPLY", companionId, message }))
        .catch((e) => showToast(rpcErrorMessage(e)))
        .finally(() => setTyping(false));
    }, delay);
  }

  function retry() {
    const c = companion!;
    if (c.messages.length === 0) {
      void fetchAndPlay(c.id, "opener");
      return;
    }
    const lastMe = [...c.messages].reverse().find((m) => m.who === "me");
    void fetchAndPlay(c.id, "reply", lastMe?.id);
  }

  async function onConsentContinue() {
    const uid = auth.user?.id;
    if (!uid) return;
    try {
      await insertConsent(uid, LIVE_CONSENT_VERSION);
      dispatch({ type: "SET_CONSENT_VERSION", version: LIVE_CONSENT_VERSION });
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

  // Ledger state is judged on the server's clock (spec D8), never the debug clock.
  const status = canSend(state.ledger, serverNow());
  const onPass = passActive(state.ledger, serverNow());
  const n = freeLeft(state.ledger, serverNow());
  let variant: ComposerVariant = "normal";
  if (status === "capped") variant = "capped";
  else if (status === "empty") variant = "empty";
  else if (!onPass && n === 1) variant = "oneLeft";

  const firstName = firstNameFromFull(template.name);
  const paused = companion.pausedReason === "age_check";
  const presenceOverride = live ? heart.now(companion, now()).block.presence : undefined;

  return (
    <div className={styles.page}>
      <ChatHeader
        template={template}
        onBack={() => router.push("/home")}
        onOpenProfile={() => router.push(`/profile/${companion.id}`)}
        onLongPressAvatar={() => openSheet("switcher", { currentId: companion.id })}
        onOverflow={() => setShowOverflow((v) => !v)}
        presenceOverride={presenceOverride}
      />
      {ctxCard && <ContextCard title={ctxCard.title} line={ctxCard.line} onGone={() => setCtxCard(null)} />}
      {showOverflow && (
        <div className={styles.overflowMenu} role="menu">
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
          <button
            type="button"
            role="menuitem"
            className={styles.overflowRow}
            onClick={() => {
              setShowOverflow(false);
              router.push("/home");
            }}
          >
            {COPY.chat.overflowHome}
          </button>
        </div>
      )}
      <MessageList
        messages={companion.messages}
        dividerBeforeAt={dividerBeforeAtRef.current}
        typing={typing}
        companionColor={template.palette}
        footer={live && resourceOpen ? <ResourceCard onDismiss={() => setResourceOpen(false)} /> : undefined}
        onRetry={failedMode ? retry : null}
      />
      {!paused && <Composer variant={variant} persona={firstName} onSend={(text) => void handleSend(text)} onOpenPaywall={() => openSheet("paywall")} />}
      {paused && <AgeCheckSheet error={ageError} onAdult={(dob) => void onAgeAdult(dob)} onUnder18={() => void onAgeUnder18()} />}
      {needsConsent && <ConsentUpdateSheet onContinue={() => void onConsentContinue()} onNotNow={() => router.push("/home")} />}
      {screenFx && <ScreenFx kind={screenFx} onDone={() => setScreenFx(null)} />}
    </div>
  );
}
