import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

/**
 * Carries an anonymous user's companions into the account the caller has just
 * logged into. Both sessions are verified here with the service client: the
 * Bearer token must belong to a permanent user, `anonAccessToken` to an
 * anonymous one, and they must differ. Both tokens are short-lived JWTs that
 * only the signed-in browser holds, which is what limits who can call this.
 * The anonymous auth user is deleted after a successful merge. Any
 * verification failure is a bare 401.
 */
export async function POST(req: Request) {
  const bearer = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  let anonToken: unknown;
  try {
    anonToken = ((await req.json()) as { anonAccessToken?: unknown }).anonAccessToken;
  } catch {
    return unauthorized();
  }
  if (!bearer || typeof anonToken !== "string" || !anonToken) return unauthorized();

  const admin = getAdminClient();
  const [target, anon] = await Promise.all([admin.auth.getUser(bearer), admin.auth.getUser(anonToken)]);
  const targetUser = target.data.user;
  const anonUser = anon.data.user;
  if (target.error || anon.error || !targetUser || !anonUser) return unauthorized();
  if (targetUser.is_anonymous === true || anonUser.is_anonymous !== true || targetUser.id === anonUser.id) return unauthorized();

  const { data, error } = await admin.rpc("merge_anonymous", { p_anon: anonUser.id, p_target: targetUser.id });
  if (error) return NextResponse.json({ error: "merge_failed" }, { status: 500 });

  const { error: deleteError } = await admin.auth.admin.deleteUser(anonUser.id);
  if (deleteError) console.warn("merge: anonymous user not deleted", deleteError.message);
  return NextResponse.json(data);
}
