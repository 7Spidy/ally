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
 * Registered as 'account'. Format-only validation, no network call — spec
 * §2 ("Auth: Stubbed"). *When* to open this sheet (the 1st/3rd/7th
 * exchange gating, reading `companions[0].exchanges`) is the chat screen's
 * job, owned by a different work area; this component just needs a simple
 * props contract for them to wire against:
 *
 *   <AccountSheet personaName={string} exchanges={number} />
 *
 * `exchanges` drives the same nudge/return/block behaviour as the
 * reference build's `setupAccount()`: dismissible until the 7th exchange,
 * then the "Not now" button disappears (a hard block). Since this build
 * only ever reaches the first exchange in practice, only the nudge state
 * is reachable today — the other two are built for correctness per spec.
 */
export function AccountSheet(props: Record<string, unknown>) {
  const personaName = typeof props.personaName === "string" ? props.personaName : "";
  const exchanges = typeof props.exchanges === "number" ? props.exchanges : 1;

  const { dispatch } = useAlly();
  const { closeSheet } = useSheet();
  const [step, setStep] = useState<"contact" | "otp">("contact");
  const [contact, setContact] = useState("");
  const [otp, setOtp] = useState("");

  const dismissible = exchanges < 7;
  const contactOk = validContact(contact.trim());
  const otpOk = /^\d{6}$/.test(otp);
  const kind: "phone" | "email" = contact.includes("@") ? "email" : "phone";

  function onSendCode() {
    if (!contactOk) return;
    setStep("otp");
    setOtp("");
  }

  function onVerify() {
    if (!otpOk) return;
    dispatch({ type: "ACCOUNT_SAVE", contact: contact.trim(), kind, now: now() });
    closeSheet();
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
        {step === "contact" ? (
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
                if (e.key === "Enter" && contactOk) onSendCode();
              }}
            />
            <button type="button" className="btn primary" disabled={!contactOk} onClick={onSendCode}>
              Send code
            </button>
          </div>
        ) : (
          <div className="stack">
            <input
              className={`${styles.field} ${styles.otp}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              aria-label="Six-digit code"
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && otpOk) onVerify();
              }}
            />
            <button type="button" className="btn primary" disabled={!otpOk} onClick={onVerify}>
              Save
            </button>
          </div>
        )}
        {dismissible && (
          <button type="button" className="btn quiet" onClick={onDismiss}>
            Not now
          </button>
        )}
      </div>
    </Sheet>
  );
}
