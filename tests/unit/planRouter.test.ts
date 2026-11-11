import { describe, it, expect } from "vitest";
import { shouldRouteToLocked } from "@/components/PlanRouter";

describe("routing an expired user to the plans screen", () => {
  it("routes an expired user from home, a chat or settings, once per session", () => {
    for (const path of ["/home", "/chat/c_abc", "/settings", "/profile/c_abc"]) {
      expect(shouldRouteToLocked(path, "expired", false), path).toBe(true);
      expect(shouldRouteToLocked(path, "expired", true), `${path} after routing`).toBe(false);
    }
  });

  it("never routes anyone who has a plan or a trial", () => {
    for (const plan of ["trial", "pro", "max", "ultra"]) expect(shouldRouteToLocked("/home", plan, false), plan).toBe(false);
  });

  it("leaves the boot screen, the plans screen, sign-in, first run and the admin console alone", () => {
    for (const path of ["/", "/plans", "/plans/anything", "/login", "/login/reset", "/onboarding/gender", "/blocked", "/privacy", "/delete-account", "/admin", "/admin/users/x", "/auth/callback"]) {
      expect(shouldRouteToLocked(path, "expired", false), path).toBe(false);
    }
  });

  it("does not mistake a similarly named path for an excluded one", () => {
    expect(shouldRouteToLocked("/planning", "expired", false)).toBe(true);
  });
});
