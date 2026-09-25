/**
 * Spec §5.1.6: which routes need a Supabase session (anonymous counts).
 * P3: `/admin` and everything under it also needs profiles.role = 'admin'.
 * Pure.
 */

export type RouteAccess = "public" | "session" | "admin";

const PUBLIC_EXACT = new Set(["/", "/onboarding/consent", "/blocked", "/login"]);
const PUBLIC_PREFIXES = ["/login/", "/auth/", "/api/test/"];

export function routeAccess(pathname: string): RouteAccess {
  const path = pathname.split("?")[0].split("#")[0];
  const normalised = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (PUBLIC_EXACT.has(normalised)) return "public";
  if (PUBLIC_PREFIXES.some((p) => normalised.startsWith(p))) return "public";
  if (normalised === "/admin" || normalised.startsWith("/admin/")) return "admin";
  return "session";
}
