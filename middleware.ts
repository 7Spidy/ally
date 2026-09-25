import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routeAccess } from "@/lib/authRoutes";

/**
 * Session refresh (the standard @supabase/ssr pattern) plus the route
 * guard: a `session` or `admin` route with no user redirects to `/`.
 * Anonymous sessions count as sessions. An `admin` route with a user who
 * isn't an admin redirects to `/home` (a valid account, just not allowed
 * here). This is UX only; the admin RPCs enforce is_admin() themselves.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Without Supabase env (e.g. a bare `next build` check) there is nothing to refresh or guard.
  if (!url || !key) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Do not run code between createServerClient and getUser(): it refreshes the session.
  // getUser() (a server round trip) rather than getClaims() (a local JWT
  // check) on purpose: "log out everywhere" and password reset revoke sessions
  // server-side, and a locally verified token would keep passing until it
  // expires an hour later.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const hasUser = !!user;

  // A cookie that no longer validates (revoked, deleted user) would make the
  // client believe it is signed in and bounce forever between `/` and a
  // guarded route. Clear it so the redirect below lands on a clean first run.
  if (!hasUser && request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))) {
    await supabase.auth.signOut({ scope: "local" });
  }

  const redirectTo = (pathname: string) => {
    const redirect = request.nextUrl.clone();
    redirect.pathname = pathname;
    redirect.search = "";
    const redirectResponse = NextResponse.redirect(redirect);
    // Carry any cookies the refresh just set (e.g. a cleared session).
    for (const c of response.cookies.getAll()) redirectResponse.cookies.set(c);
    return redirectResponse;
  };

  const access = routeAccess(request.nextUrl.pathname);
  if (!hasUser && access !== "public") return redirectTo("/");

  if (access === "admin") {
    // RLS lets a user read their own profile row.
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle();
    if (profile?.role !== "admin") return redirectTo("/home");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|assets/|favicon|manifest|.*\\.(?:png|jpg|jpeg|webp|svg|mp4|json)$).*)"],
};
