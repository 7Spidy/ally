/**
 * P3 admin console: the shapes admin_list_users / admin_get_user return
 * (supabase/migrations/20260925000001_admin_console.sql) and pure display
 * helpers for /admin. Timestamps arrive as ISO strings.
 */

export interface AdminLedger {
  slots_unlocked: number;
  free_used: number;
  free_daily: number;
  free_left: number;
  pass_cap: number;
  pass_active: boolean;
  pass_started_at: string | null;
  pass_ends_at: string | null;
  pass_used: number | null;
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  is_anonymous: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  display_name: string | null;
  role: "user" | "admin" | null;
  status: "active" | "suspended" | null;
  companion_count: number;
  message_count: number;
  ledger: AdminLedger;
}

export interface AdminCursor {
  created_at: string;
  id: string;
}

export interface AdminListPage {
  users: AdminUserRow[];
  next_cursor: AdminCursor | null;
}

export interface AdminCompanion {
  id: string;
  template_id: string;
  deck_gender: "woman" | "man";
  status: "active" | "parted";
  exchanges: number;
  message_count: number;
  created_at: string;
  last_opened_at: string;
  parted_at: string | null;
}

export type AdminAction =
  | "suspend"
  | "unsuspend"
  | "grant_pass"
  | "end_pass"
  | "set_slots"
  | "set_free_daily_override"
  | "set_pass_cap_override"
  | "force_logout";

export interface AdminAuditEntry {
  id: number;
  action: AdminAction;
  actor_id: string;
  actor_email: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}

export interface AdminUserDetail extends AdminUserRow {
  limits: {
    free_daily_override: number | null;
    pass_cap_override: number | null;
    updated_at: string;
    updated_by: string | null;
  } | null;
  defaults: { free_daily: number; pass_cap: number; pass_hours: number; max_companions: number };
  companions: AdminCompanion[];
  audit: AdminAuditEntry[];
}

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "25 Sep 2026, 14:05" in IST, or "Never" for a null timestamp. */
export function formatWhen(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never";
  return DATE_FMT.format(d);
}

/** Email for a linked account, "Anonymous" for a guest. */
export function userLabel(u: Pick<AdminUserRow, "email" | "is_anonymous">): string {
  if (u.email) return u.email;
  return u.is_anonymous ? "Anonymous" : "No email";
}

/** One line on the user's balance: the pass while one is active, else free messages left today. */
export function ledgerSummary(l: AdminLedger): string {
  if (l.pass_active) return `Pass until ${formatWhen(l.pass_ends_at)}, ${l.pass_used ?? 0} of ${l.pass_cap} used`;
  return `${l.free_left} of ${l.free_daily} free left today`;
}

/**
 * Reads an override field. Empty clears the override (null); otherwise a
 * whole number of zero or more. Anything else is invalid.
 */
export function parseOverride(input: string): { ok: true; value: number | null } | { ok: false } {
  const s = input.trim();
  if (s === "") return { ok: true, value: null };
  if (!/^\d+$/.test(s)) return { ok: false };
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n > 1_000_000) return { ok: false };
  return { ok: true, value: n };
}

const ACTION_LABEL: Record<AdminAction, string> = {
  suspend: "Suspended",
  unsuspend: "Unsuspended",
  grant_pass: "Granted a pass",
  end_pass: "Ended the pass",
  set_slots: "Changed slots",
  set_free_daily_override: "Changed free daily limit",
  set_pass_cap_override: "Changed pass cap",
  force_logout: "Logged out everywhere",
};

function show(v: unknown): string {
  if (v === null || v === undefined) return "default";
  if (typeof v === "string" && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatWhen(v);
  return String(v);
}

/** A short human line for an audit row, e.g. "Changed slots: 1 → 3". */
export function auditLine(a: Pick<AdminAuditEntry, "action" | "old_value" | "new_value">): string {
  const label = ACTION_LABEL[a.action] ?? a.action;
  switch (a.action) {
    case "set_slots":
      return `${label}: ${show(a.old_value?.slots_unlocked)} → ${show(a.new_value?.slots_unlocked)}`;
    case "set_free_daily_override":
      return `${label}: ${show(a.old_value?.free_daily_override)} → ${show(a.new_value?.free_daily_override)}`;
    case "set_pass_cap_override":
      return `${label}: ${show(a.old_value?.pass_cap_override)} → ${show(a.new_value?.pass_cap_override)}`;
    case "grant_pass":
      return `${label} (${show(a.new_value?.hours)}h)`;
    case "force_logout":
      return `${label} (${show(a.old_value?.sessions)} sessions)`;
    default:
      return label;
  }
}
