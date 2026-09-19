"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import { useManifest } from "@/state/useManifest";
import { ManifestGate } from "@/components/ManifestGate";
import { byId } from "@/lib/selectors";
import { canSend, freeLeft, passActive } from "@/lib/ledger";
import { openerFor, COPY } from "@/lib/copy";
import { firstNameFromFull } from "@/lib/engine";
import { now } from "@/lib/clock";
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
    dividerBeforeAtRef.current = companion.lastOpenedAt;
    dispatch({ type: "OPEN_CHAT", companionId: companion.id, now: now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion?.id]);

  // CONFIRM_LOCK creates a companion with messages: []. Seed the opener
  // the first time this chat is ever opened.
  useEffect(() => {
    if (!companion || seededRef.current) return;
    if (companion.messages.length > 0) return;
    if (!companion.core.primary) return;
    seededRef.current = true;
    const pressure: Pressure = companion.answers.q10 ?? "head";
    const text = openerFor(companion.core.primary, pressure, state.user.displayName);
    dispatch({ type: "SEED_OPENER", companionId: companion.id, text, now: now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion?.id, companion?.messages.length]);

  // Account sheet nudge, spec §8.1's exchange-count rule applied to THIS
  // chat's companion (see report — the spec literally says
  // `companions[0].exchanges`, almost certainly a slip for "the current
  // companion", since a round-two companion would otherwise never trigger
  // its own nudge).
  useEffect(() => {
    if (!companion || state.user.accountAt) return;
    const n = companion.exchanges;
    if (n >= 7 && accountNudgeRef.current < 7) {
      accountNudgeRef.current = 7;
      openSheet("account", { blocking: true });
    } else if (n === 3 && accountNudgeRef.current < 3) {
      accountNudgeRef.current = 3;
      openSheet("account");
    } else if (n === 1 && accountNudgeRef.current < 1) {
      accountNudgeRef.current = 1;
      openSheet("account");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion?.exchanges, state.user.accountAt]);

  if (!companion || !template) {
    return <div className={styles.notFound}>Not found.</div>;
  }

  function handleSend(text: string) {
    dispatch({ type: "SEND_MESSAGE", companionId: companion!.id, text, now: now() });
    setTyping(true);
    const delay = 1200 + Math.random() * 600;
    setTimeout(() => {
      setTyping(false);
      dispatch({ type: "RECEIVE_REPLY", companionId: companion!.id, now: now() });
    }, delay);
  }

  const status = canSend(state.ledger, now());
  const onPass = passActive(state.ledger, now());
  const n = freeLeft(state.ledger, now());
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
      <Composer variant={variant} persona={firstName} onSend={handleSend} onOpenPaywall={() => openSheet("paywall")} />
    </div>
  );
}
