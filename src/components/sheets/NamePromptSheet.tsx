"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useAuth } from "@/state/useAuth";
import { Sheet } from "@/components/Sheet";
import { COPY } from "@/lib/copy";
import { checkName, NAME_MAX } from "@/lib/nameCheck";
import { shouldPromptName } from "@/lib/namePrompt";
import { rpcErrorMessage, setDisplayName } from "@/lib/supabase/queries";

/** Non-dismissable: shown over the app shell when a signed-in user past onboarding has no name. */
export function NamePromptHost() {
  const { state, ready } = useAlly();
  const auth = useAuth();
  const pathname = usePathname();
  if (!shouldPromptName({ ready, hasSession: !!auth.user, state, pathname })) return null;
  return <NamePromptSheet />;
}

function NamePromptSheet() {
  const { dispatch } = useAlly();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const result = checkName(value);
  const error = failure ?? (touched && !result.ok ? COPY.name.errors[result.problem] : null);

  async function onSave() {
    setTouched(true);
    if (!result.ok || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const saved = await setDisplayName(result.value);
      dispatch({ type: "SET_USER_NAME", name: saved });
    } catch (e) {
      setFailure(rpcErrorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Sheet labelledBy="name-prompt-heading">
      <div className="stack">
        <h2 className="q" id="name-prompt-heading" style={{ fontSize: 26 }}>
          {COPY.namePrompt.heading}
        </h2>
        <p className="sub">{COPY.namePrompt.sub}</p>
        <input
          type="text"
          maxLength={NAME_MAX}
          autoComplete="given-name"
          autoCapitalize="words"
          spellCheck={false}
          aria-label={COPY.namePrompt.heading}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "name-prompt-error" : undefined}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setFailure(null);
          }}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSave();
          }}
        />
        {error && (
          <p id="name-prompt-error" role="alert" className="sub">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn primary" disabled={!result.ok || saving} onClick={() => void onSave()}>
            {COPY.namePrompt.save}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
