import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { CONSENT_VERSION } from "@/lib/config";

/**
 * E2E-only anonymous session bootstrap. 404 unless ALLY_E2E=1, which must
 * never be set on Vercel. Signs in anonymously (setting the session
 * cookies), records consent and returns the new user id.
 */
export async function GET() {
  if (process.env.ALLY_E2E !== "1") return new NextResponse(null, { status: 404 });

  const supabase = await getServerClient();
  const { data, error } = await supabase.auth.signInAnonymously({ options: { captchaToken: "XXXX.DUMMY.TOKEN.XXXX" } });
  if (error || !data.user) return NextResponse.json({ error: error?.message ?? "no user" }, { status: 500 });

  const { error: consentError } = await supabase.from("consents").insert({ user_id: data.user.id, version: CONSENT_VERSION, marketing: false });
  if (consentError) return NextResponse.json({ error: consentError.message }, { status: 500 });

  return NextResponse.json({ userId: data.user.id });
}
