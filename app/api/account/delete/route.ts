import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { DELETE_REAUTH_MINUTES } from "@/lib/config";
import { now } from "@/lib/clock";

interface AmrEntry {
  method?: string;
  timestamp?: number;
}

/**
 * Deletes the caller's own account. Requires a fresh email-code sign-in:
 * the JWT's `amr` claim must hold an `otp` or `magiclink` entry within
 * DELETE_REAUTH_MINUTES. The uid always comes from the session, never from
 * the request body. FK cascades remove profiles and consents.
 */
export async function POST() {
  const supabase = await getServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const amr = (claims.amr ?? []) as AmrEntry[];
  const cutoffSeconds = Math.floor(now() / 1000) - DELETE_REAUTH_MINUTES * 60;
  const fresh = amr.some((a) => (a.method === "otp" || a.method === "magiclink") && typeof a.timestamp === "number" && a.timestamp >= cutoffSeconds);
  if (!fresh) return NextResponse.json({ error: "reauth_required" }, { status: 403 });

  const { error: deleteError } = await getAdminClient().auth.admin.deleteUser(claims.sub);
  if (deleteError) return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
