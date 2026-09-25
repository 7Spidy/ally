/**
 * P3: the admin console's writes, from the browser. Each is an admin_* RPC
 * (which checks is_admin() itself) or, for force logout, the server route
 * that holds the service-role key. Errors are thrown; callers toast them.
 */

import { getBrowserClient } from "@/lib/supabase/browser";

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await getBrowserClient().rpc(fn, args);
  if (error) throw error;
  return data;
}

export function adminSetStatus(target: string, status: "active" | "suspended") {
  return call("admin_set_status", { target, status });
}

export function adminSetSlots(target: string, slots: number) {
  return call("admin_set_slots", { target, slots });
}

/** null clears the override. */
export function adminSetFreeDailyOverride(target: string, value: number | null) {
  return call("admin_set_free_daily_override", { target, value });
}

/** null clears the override. */
export function adminSetPassCapOverride(target: string, value: number | null) {
  return call("admin_set_pass_cap_override", { target, value });
}

/** hours null uses the default pass length. */
export function adminGrantPass(target: string, hours: number | null = null) {
  return call("admin_grant_pass", { target, hours });
}

export function adminEndPass(target: string) {
  return call("admin_end_pass", { target });
}

export async function adminForceLogout(target: string): Promise<{ revoked: number }> {
  const res = await fetch("/api/admin/force-logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  const body = (await res.json().catch(() => ({}))) as { revoked?: number; error?: string };
  if (!res.ok) throw new Error(body.error ?? `force_logout_failed_${res.status}`);
  return { revoked: body.revoked ?? 0 };
}
