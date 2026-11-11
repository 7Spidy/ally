"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";

const SESSION_KEY = "ally_locked_routed";
/** Backs the session flag when storage is blocked, so a blocked sessionStorage cannot cause a redirect loop. */
let routedInMemory = false;

/** Screens an expired user is never pulled away from: sign-in and first-run, legal pages, the plans screen itself, the admin console. */
const SKIP_PREFIXES = ["/plans", "/login", "/onboarding", "/blocked", "/privacy", "/terms", "/delete-account", "/admin", "/auth"];

export function shouldRouteToLocked(pathname: string, plan: string, alreadyRouted: boolean): boolean {
  if (plan !== "expired" || alreadyRouted) return false;
  if (pathname === "/") return false; // the boot screen is still choosing where to land
  return !SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * On the first load of each session for a user whose trial is over and who has
 * no plan, sends them to the plans screen (from=locked). Once per session:
 * "Read your chats" takes them on to the companion list without being bounced back.
 */
export function PlanRouter() {
  const { state, ready } = useAlly();
  const pathname = usePathname();
  const router = useRouter();
  const plan = state.entitlement.plan;

  useEffect(() => {
    if (!ready) return;
    let routed = routedInMemory;
    try {
      routed = routed || window.sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      /* storage blocked: the in-memory guard below still stops a loop */
    }
    if (!shouldRouteToLocked(pathname, plan, routed)) return;
    routedInMemory = true;
    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
    router.replace("/plans?from=locked");
  }, [ready, pathname, plan, router]);

  return null;
}
