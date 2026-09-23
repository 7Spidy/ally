"use client";

import { useState } from "react";
import styles from "./PasswordField.module.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
  label: string;
  autoComplete?: "current-password" | "new-password";
  onEnter?: () => void;
  disabled?: boolean;
}

/** Password input with a show/hide toggle. */
export function PasswordField({ value, onChange, label, autoComplete = "current-password", onEnter, disabled }: Props) {
  const [shown, setShown] = useState(false);
  return (
    <div className={styles.wrap}>
      <input
        className={styles.field}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        aria-label={label}
        placeholder={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
      />
      <button type="button" className={styles.toggle} aria-pressed={shown} onClick={() => setShown((s) => !s)}>
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}
