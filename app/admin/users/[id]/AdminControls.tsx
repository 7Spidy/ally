"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/state/useToast";
import { formatWhen, parseOverride, userLabel, type AdminUserDetail } from "@/lib/admin";
import {
  adminEndPass,
  adminForceLogout,
  adminGrantPass,
  adminSetFreeDailyOverride,
  adminSetPassCapOverride,
  adminSetSlots,
  adminSetStatus,
} from "@/lib/supabase/adminQueries";
import styles from "../../admin.module.css";

const ERRORS: Record<string, string> = {
  not_admin: "Only admins can do that.",
  forbidden: "Only admins can do that.",
  user_not_found: "That user no longer exists.",
  cannot_suspend_self: "You can't suspend your own account.",
  invalid_slots: "Slots must be between 1 and 3.",
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
  const slots = Array.from({ length: user.defaults.max_companions }, (_, i) => i + 1);

  return (
    <section className={styles.group} aria-labelledby="ledger">
      <h2 id="ledger" className={styles.groupLabel}>
        Ledger
      </h2>

      <div className={styles.row}>
        <span className={styles.rowLabel}>Free today</span>
        <span className={styles.rowValue}>
          {l.free_used} used of {l.free_daily}, {l.free_left} left
        </span>
      </div>

      <div className={styles.control}>
        <div className={styles.controlHead}>
          <span>Day pass</span>
          {l.pass_active ? (
            <span className={`${styles.badge} ${styles.badgePass}`}>Active</span>
          ) : (
            <span className={styles.rowValue}>None</span>
          )}
        </div>
        {l.pass_active && (
          <p className={styles.note}>
            Until {formatWhen(l.pass_ends_at)}, {l.pass_used ?? 0} of {l.pass_cap} messages used.
          </p>
        )}
        <button
          type="button"
          className="btn secondary"
          disabled={locked}
          onClick={() => void run("grant", () => adminGrantPass(user.id), "Pass granted.")}
        >
          {pending === "grant" ? "Saving…" : `Grant a ${user.defaults.pass_hours}-hour pass`}
        </button>
        {l.pass_active && (
          <button type="button" className="btn secondary" disabled={locked} onClick={() => void run("end", () => adminEndPass(user.id), "Pass ended.")}>
            {pending === "end" ? "Saving…" : "End pass now"}
          </button>
        )}
      </div>

      <div className={styles.control}>
        <div className={styles.controlHead}>
          <span id="slotsLabel">Companion slots</span>
          <span className={styles.rowValue}>{pending === "slots" ? "Saving…" : `${l.slots_unlocked} unlocked`}</span>
        </div>
        <div className={styles.segmented} role="group" aria-labelledby="slotsLabel">
          {slots.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={l.slots_unlocked === n}
              aria-label={`${n} ${n === 1 ? "slot" : "slots"}`}
              disabled={locked}
              onClick={() => {
                if (n !== l.slots_unlocked) void run("slots", () => adminSetSlots(user.id, n));
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <OverrideField
        key={`free-${user.limits?.free_daily_override ?? "d"}`}
        label="Free messages per day"
        current={user.limits?.free_daily_override ?? null}
        fallback={user.defaults.free_daily}
        locked={locked}
        saving={pending === "free"}
        onSave={(v) => void run("free", () => adminSetFreeDailyOverride(user.id, v), "Saved.")}
      />
      <OverrideField
        key={`cap-${user.limits?.pass_cap_override ?? "d"}`}
        label="Pass message cap"
        current={user.limits?.pass_cap_override ?? null}
        fallback={user.defaults.pass_cap}
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
