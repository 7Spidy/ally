"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import { useManifest } from "@/state/useManifest";
import { useToast } from "@/state/useToast";
import { ManifestGate } from "@/components/ManifestGate";
import { byId } from "@/lib/selectors";
import { canSend, freeLeft, passActive } from "@/lib/ledger";
import { openerFor, replyFor, COPY } from "@/lib/copy";
import { firstNameFromFull } from "@/lib/engine";
import { serverNow } from "@/lib/clock";
import { openChat, receiveReply, seedOpener, sendMessage } from "@/lib/supabase/queries";
import type { Pressure } from "@/state/schema";
import { ChatHeader } from "@/components/ChatHeader";
import { MessageList } from "@/components/MessageList";
import { Composer, type ComposerVariant } from "@/components/Composer";
import styles from "./page.module.css";

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
  const { openSheet } = useSheet();
  const { templates } = useManifest();
  const showToast = useToast();

  const companion = byId(state, id);
  const template = companion ? templates.find((t) => t.id === companion.templateId) : undefined;

  const openedRef = useRef(false);
  const seededRef = useRef(false);
  const dividerBeforeAtRef = useRef<number | null>(null);
  const [typing, setTyping] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const accountNudgeRef = useRef<number>(0); // last exchange threshold nudged at

  // Capture the pre-open lastOpenedAt for the "Since you left" divider
  // BEFORE dispatching OPEN_CHAT, which overwrites it.
  useEffect(() => {
    if (!companion || openedRef.current) return;
    openedRef.current = true;
    // Never on the very-first-ever open (fresh lock, no messages yet) —
    // otherwise the opener we're about to seed reads as "since you left"
    // before the user has seen a single message.
    const isFirstOpenEver = companion.messages.length === 0 && companion.lastOpenedAt === companion.createdAt;
    dividerBeforeAtRef.current = isFirstOpenEver ? null : companion.lastOpenedAt;
    const companionId = companion.id;
    openChat(companionId)
      .then(({ lastOpenedAt }) => dispatch({ type: "OPEN_CHAT", companionId, lastOpenedAt }))
      .catch(() => showToast(COPY.auth.network));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion?.id]);

  // CONFIRM_LOCK creates a companion with messages: []. Seed the opener
  // the first time this chat is ever opened. seed_opener only writes into
  // an empty conversation, so a second tab can't post a second opener.
  useEffect(() => {
    if (!companion || seededRef.current) return;
    if (companion.messages.length > 0) return;
    if (!companion.core.primary) return;
    seededRef.current = true;
    const companionId = companion.id;
    const pressure: Pressure = companion.answers.q10 ?? "head";
    const text = openerFor(companion.core.primary, pressure, state.user.displayName);
    seedOpener(companionId, text)
      .then(({ message }) => {
        if (message) dispatch({ type: "SEED_OPENER", companionId, message });
      })
      .catch(() => {
        seededRef.current = false;
        showToast(COPY.auth.network);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion?.id, companion?.messages.length]);

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
  // transaction; the message and ledger shown are the ones it returns. The
  // reply text is still generated here (no LLM yet), only stored server-side.
  async function handleSend(text: string) {
    const companionId = companion!.id;
    const primary = companion!.core.primary;
    let res;
    try {
      res = await sendMessage(companionId, text);
    } catch {
      showToast(COPY.auth.network);
      return;
    }
    if (res.blocked || !res.message) {
      // Out of messages server-side: show the matching bar or paywall state.
      dispatch({ type: "LEDGER_SYNC", ledger: res.ledger });
      return;
    }
    dispatch({ type: "SEND_MESSAGE", companionId, message: res.message, exchanges: res.exchanges, ledger: res.ledger });
    if (!primary) return;
    const reply = replyFor(primary, res.exchanges);
    setTyping(true);
    const delay = 1200 + Math.random() * 600;
    setTimeout(() => {
      receiveReply(companionId, reply)
        .then(({ message }) => dispatch({ type: "RECEIVE_REPLY", companionId, message }))
        .catch(() => showToast(COPY.auth.network))
        .finally(() => setTyping(false));
    }, delay);
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

  return (
    <div className={styles.page}>
      <ChatHeader
        template={template}
        onBack={() => router.push("/home")}
        onOpenProfile={() => router.push(`/profile/${companion.id}`)}
        onLongPressAvatar={() => openSheet("switcher", { currentId: companion.id })}
        onOverflow={() => setShowOverflow((v) => !v)}
      />
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
      <MessageList messages={companion.messages} dividerBeforeAt={dividerBeforeAtRef.current} typing={typing} />
      <Composer variant={variant} persona={firstName} onSend={(text) => void handleSend(text)} onOpenPaywall={() => openSheet("paywall")} />
    </div>
  );
}
