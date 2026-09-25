import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * P3 "log out everywhere" for another user. Revoking someone else's
 * sessions is an auth-server operation, not something the caller's own
 * session may do, so after confirming the caller is an admin this route
 * uses the service-role client to call admin_revoke_sessions (executable
 * by service_role only), which deletes the target's sessions and writes
 * the admin_audit row in one transaction. The actor always comes from the
 * verified session, never the request body.
 */
export async function POST(request: Request) {
  const supabase = await getServerClient();
  // getUser(), not getClaims(): a revoked admin session must fail here too.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { target?: unknown } | null;
  const target = typeof body?.target === "string" ? body.target : "";
  if (!UUID.test(target)) return NextResponse.json({ error: "invalid_target" }, { status: 400 });

  const { data, error } = await getAdminClient().rpc("admin_revoke_sessions", { actor: user.id, target });
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "42501" ? 403 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ revoked: (data as { revoked: number }).revoked });
}
