"use client";

import { useEffect, useState } from "react";
import { OTP_RESEND_SECONDS } from "@/lib/config";
import { COPY, fill } from "@/lib/copy";

interface Props {
  onResend: () => void | Promise<void>;
  /** Change this to restart the countdown (e.g. after a resend succeeds). */
  restartKey?: number;
}

/** "Resend in {s}s" for OTP_RESEND_SECONDS, then "Resend code". Counts by ticks, no Date reads. */
export function ResendButton({ onResend, restartKey = 0 }: Props) {
  const [left, setLeft] = useState(OTP_RESEND_SECONDS);

  useEffect(() => {
    setLeft(OTP_RESEND_SECONDS);
    const id = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [restartKey]);

  if (left > 0) {
    return (
      <button type="button" className="btn quiet" disabled>
        {fill(COPY.auth.resendIn, { s: left })}
      </button>
    );
  }
  return (
    <button type="button" className="btn quiet" onClick={() => void onResend()}>
      {COPY.auth.resend}
    </button>
  );
}
