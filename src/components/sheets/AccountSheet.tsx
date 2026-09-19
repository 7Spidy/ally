"use client";

import { useState } from "react";
import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import { Sheet } from "@/components/Sheet";
import { now } from "@/lib/clock";
import { COPY, fill } from "@/lib/copy";
import styles from "./AccountSheet.module.css";

const VALID_CONTACT = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const VALID_PHONE = /^\+?[0-9][0-9 ]{8,14}$/;

function validContact(v: string) {
  return VALID_CONTACT.test(v) || VALID_PHONE.test(v);
}

/**
 * Registered as 'account'. Format-only validation, no network call, NO OTP
 * — spec v3.0 §2 is explicit: "Auth: Stubbed... validates format only,
 * sets user.accountAt. No OTP, no verification." (This supersedes the v1.0
 * onboarding spec's six-digit-OTP field; v3.0 §1 states it "supersedes
 * every earlier spec in this repo.") `displayName` is already known from
 * onboarding's name step, so this sheet only collects the contact string.
 *
 * *When* to open this sheet (the 1st/3rd/7th exchange gating) is the chat
 * screen's job, owned by a different work area; this component just needs
 * a simple props contract for them to wire against:
 *
 *   <AccountSheet personaName={string} exchanges={number} onSaved={() => void} />
 *
 * `exchanges` drives the same nudge/return/block behaviour as the
 * reference build's `setupAccount()`: dismissible until the 7th exchange,
 * then the "Not now" button disappears (a hard block). Since this build
 * only ever reaches the first exchange in practice, only the nudge state
 * is reachable today — the other two are built for correctness per spec.
 * §8.2 step 1's round-two entry point opens this with `exchanges: 7`
 * (forcing non-dismissible, per "it cannot be dismissed here") and an
 * `onSaved` callback that resumes round two once the account is created —
 * see IntroSheet.tsx.
 */
export function AccountSheet(props: Record<string, unknown>) {
  const personaName = typeof props.personaName === "string" ? props.personaName : "";
  const exchanges = typeof props.exchanges === "number" ? props.exchanges : 1;
  const onSaved = typeof props.onSaved === "function" ? (props.onSaved as () => void) : null;

  const { dispatch } = useAlly();
  const { closeSheet, dismissForNavigation } = useSheet();
  const [contact, setContact] = useState("");

  const dismissible = exchanges < 7;
  const contactOk = validContact(contact.trim());
  const kind: "phone" | "email" = contact.includes("@") ? "email" : "phone";

  function onSave() {
    if (!contactOk) return;
    dispatch({ type: "ACCOUNT_SAVE", contact: contact.trim(), kind, now: now() });
    // dismissForNavigation(), not closeSheet(): when `onSaved` reopens
    // another sheet right after, closeSheet()'s async history.back() would
    // race it — see SheetProvider.tsx's dismissForNavigation doc comment.
    // Safe to always use here (rather than only when onSaved is set): it
    // just means an unused dummy history entry lingers on the plain
    // chat-nudge path, the same accepted tradeoff made elsewhere.
    dismissForNavigation();
    onSaved?.();
  }

  function onDismiss() {
    dispatch({ type: "ACCOUNT_DISMISS" });
    closeSheet();
  }

  return (
    <Sheet labelledBy="a-heading">
      <div className="stack">
        <h1 className="q" id="a-heading">
          {fill(COPY.account.heading, { persona: personaName })}
        </h1>
        <p className="sub" style={{ marginTop: -8 }}>
          {COPY.account.sub}
        </p>
        <div className="stack">
          <input
            className={styles.field}
            type="text"
            inputMode="email"
            autoComplete="email"
            aria-label="Phone or email"
            placeholder="Phone or email"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && contactOk) onSave();
            }}
          />
          <button type="button" className="btn primary" disabled={!contactOk} onClick={onSave}>
            Save
          </button>
        </div>
        {dismissible && (
          <button type="button" className="btn quiet" onClick={onDismiss}>
            Not now
          </button>
        )}
      </div>
    </Sheet>
  );
}
