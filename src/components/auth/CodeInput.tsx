"use client";

import { useRef } from "react";
import { OTP_LENGTH } from "@/lib/config";
import { COPY } from "@/lib/copy";
import styles from "./CodeInput.module.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Fires once, when the last box is filled. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

/** Six single-digit boxes behaving as one field: type, backspace and paste all work across boxes. */
export function CodeInput({ value, onChange, onComplete, disabled, autoFocus }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? "");

  function commit(next: string) {
    const clean = next.replace(/\D/g, "").slice(0, OTP_LENGTH);
    onChange(clean);
    if (clean.length === OTP_LENGTH) onComplete?.(clean);
    return clean;
  }

  function focusBox(i: number) {
    refs.current[Math.min(Math.max(i, 0), OTP_LENGTH - 1)]?.focus();
  }

  function onInput(i: number, raw: string) {
    const typed = raw.replace(/\D/g, "");
    if (!typed) {
      // cleared this box
      commit(value.slice(0, i) + value.slice(i + 1));
      return;
    }
    const merged = value.slice(0, i) + typed + value.slice(i + 1);
    const clean = commit(merged);
    focusBox(Math.min(i + typed.length, clean.length, OTP_LENGTH - 1));
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      commit(value.slice(0, i - 1) + value.slice(i));
      focusBox(i - 1);
    } else if (e.key === "ArrowLeft") {
      focusBox(i - 1);
    } else if (e.key === "ArrowRight") {
      focusBox(i + 1);
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const clean = commit(e.clipboardData.getData("text"));
    focusBox(clean.length);
  }

  return (
    <div className={styles.row} role="group" aria-label={COPY.auth.codeLabel}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={styles.box}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={OTP_LENGTH}
          aria-label={`${COPY.auth.codeLabel}, digit ${i + 1}`}
          value={d}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
