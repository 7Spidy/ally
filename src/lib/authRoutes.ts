/** Spec §5.1.6: which routes need a Supabase session (anonymous counts). Pure. */

export type RouteAccess = "public" | "session";

const PUBLIC_EXACT = new Set(["/", "/onboarding/consent", "/blocked", "/login"]);
const PUBLIC_PREFIXES = ["/login/", "/auth/", "/api/test/"];

export function routeAccess(pathname: string): RouteAccess {
  const path = pathname.split("?")[0].split("#")[0];
  const normalised = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (PUBLIC_EXACT.has(normalised)) return "public";
  if (PUBLIC_PREFIXES.some((p) => normalised.startsWith(p))) return "public";
  return "session";
}
