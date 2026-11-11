"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/state/useToast";
import { ledgerSummary, parseOverride, userLabel, type AdminUserDetail } from "@/lib/admin";
import { adminForceLogout, adminSetFreeDailyOverride, adminSetPassCapOverride, adminSetStatus } from "@/lib/supabase/adminQueries";
import styles from "../../admin.module.css";

const ERRORS: Record<string, string> = {
  not_admin: "Only admins can do that.",
  forbidden: "Only admins can do that.",
  user_not_found: "That user no longer exists.",
  cannot_suspend_self: "You can't suspend your own account.",
  invalid_value: "Enter a whole number, or leave it empty for the default.",
};

function errorMessage(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message ?? "";
  return ERRORS[msg] ?? "Couldn't save that. Try again.";
}

/**
 * Runs one admin write, then re-renders the page from admin_get_user
 * (router.refresh) instead of patching local state: the view only ever
 * shows what the server confirmed (P2's D6 pattern). `pending` names the
 * control whose write or refresh is in flight.
 */
function useAdminAction() {
  const router = useRouter();
  const showToast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();

  async function run(key: string, fn: () => Promise<unknown>, success?: string) {
    if (busy || refreshing) return false;
    setBusy(key);
    setLast(key);
    try {
      await fn();
      if (success) showToast(success);
      startTransition(() => router.refresh());
      return true;
    } catch (e) {
      showToast(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const pending = busy ?? (refreshing ? last : null);
  return { run, pending, locked: pending !== null };
}

function OverrideField({
  label,
  current,
  fallback,
  onSave,
  locked,
  saving,
}: {
  label: string;
  current: number | null;
  fallback: number;
  onSave: (v: number | null) => void;
  locked: boolean;
  saving: boolean;
}) {
  const [text, setText] = useState(current === null ? "" : String(current));
  const parsed = parseOverride(text);
  const unchanged = parsed.ok && parsed.value === current;
  return (
    <div className={styles.control}>
      <div className={styles.controlHead}>
        <span>{label}</span>
        <span className={styles.rowValue}>{current === null ? `Default (${fallback})` : `Override (${current})`}</span>
      </div>
      <form
        className={styles.inline}
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed.ok && !unchanged) onSave(parsed.value);
        }}
      >
        <input
          className={styles.field}
          inputMode="numeric"
          aria-label={label}
          placeholder={`Default (${fallback})`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={locked}
        />
        <button type="submit" className="btn secondary" disabled={locked || !parsed.ok || unchanged}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
      {!parsed.ok && <p className={`${styles.note} ${styles.danger}`}>{ERRORS.invalid_value}</p>}
    </div>
  );
}

export function LedgerControls({ user }: { user: AdminUserDetail }) {
  const { run, pending, locked } = useAdminAction();
  const l = user.ledger;

  return (
    <section className={styles.group} aria-labelledby="ledger">
      <h2 id="ledger" className={styles.groupLabel}>
        Plan and limits
      </h2>

      <div className={styles.row}>
        <span className={styles.rowLabel}>Plan</span>
        <span className={styles.rowValue}>{ledgerSummary(l)}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Active Ally slots</span>
        <span className={styles.rowValue}>{l.slot_limit}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Chats today</span>
        <span className={styles.rowValue}>
          {l.free_used} used (trial allows {l.free_daily}, paid plans stop at their fair-use cap of {l.fair_use_cap})
        </span>
      </div>
      <p className={styles.note}>
        Plans change only through a verified Google Play purchase. To test a plan, use the plan selector in the in-chat QA panel.
      </p>

      <OverrideField
        key={`free-${user.limits?.free_daily_override ?? "d"}`}
        label="Trial chats per day"
        current={user.limits?.free_daily_override ?? null}
        fallback={user.defaults.free_daily}
        locked={locked}
        saving={pending === "free"}
        onSave={(v) => void run("free", () => adminSetFreeDailyOverride(user.id, v), "Saved.")}
      />
      <OverrideField
        key={`cap-${user.limits?.pass_cap_override ?? "d"}`}
        label="Daily fair-use cap (paid plans)"
        current={user.limits?.pass_cap_override ?? null}
        fallback={user.defaults.fair_use_cap}
        locked={locked}
        saving={pending === "cap"}
        onSave={(v) => void run("cap", () => adminSetPassCapOverride(user.id, v), "Saved.")}
      />
    </section>
  );
}

export function AccountControls({ user }: { user: AdminUserDetail }) {
  const { run, pending, locked } = useAdminAction();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const suspended = user.status === "suspended";

  return (
    <section className={styles.group} aria-labelledby="account">
      <h2 id="account" className={styles.groupLabel}>
        Account
      </h2>
      <div className={styles.control}>
        <p className={styles.note}>
          {suspended
            ? "Suspended: they can sign in and read, but can't send, meet anyone or buy anything."
            : "Suspending stops them sending, meeting anyone or buying anything. They can still sign in."}
        </p>
        <button
          type="button"
          className="btn secondary"
          disabled={locked}
          onClick={() => void run("status", () => adminSetStatus(user.id, suspended ? "active" : "suspended"), suspended ? "Unsuspended." : "Suspended.")}
        >
          {pending === "status" ? "Saving…" : suspended ? "Unsuspend account" : "Suspend account"}
        </button>
      </div>
      <div className={styles.control}>
        {!confirmLogout ? (
          <button type="button" className="btn secondary" disabled={locked} onClick={() => setConfirmLogout(true)}>
            Log out everywhere
          </button>
        ) : (
          <>
            <p className={styles.note}>This signs {userLabel(user)} out on every device. They can sign straight back in.</p>
            <button
              type="button"
              className="btn primary"
              disabled={locked}
              onClick={async () => {
                const ok = await run("logout", async () => {
                  const { revoked } = await adminForceLogout(user.id);
                  return revoked;
                }, "Logged out everywhere.");
                if (ok) setConfirmLogout(false);
              }}
            >
              {pending === "logout" ? "Logging out…" : "Log them out everywhere"}
            </button>
            <button type="button" className="btn secondary" disabled={locked} onClick={() => setConfirmLogout(false)}>
              Cancel
            </button>
          </>
        )}
      </div>
    </section>
  );
}
