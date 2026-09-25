import { describe, it, expect } from "vitest";
import { routeAccess } from "@/lib/authRoutes";

describe("routeAccess (spec §5.1.6)", () => {
  it("public routes", () => {
    for (const p of ["/", "/onboarding/consent", "/blocked", "/login", "/login/reset", "/login/anything/else", "/auth/confirm", "/auth/whatever", "/api/test/session"]) {
      expect(routeAccess(p), p).toBe("public");
    }
  });

  it("session routes, including nested chat and settings paths", () => {
    for (const p of [
      "/home",
      "/chat/c_abc",
      "/chat/c_abc/extra",
      "/profile/c_abc",
      "/settings",
      "/settings/account",
      "/settings/notifications",
      "/settings/privacy",
      "/settings/how",
      "/onboarding/location",
      "/onboarding/gender",
      "/onboarding/questions/warmth",
      "/onboarding/reveal",
      "/api/account/delete",
    ]) {
      expect(routeAccess(p), p).toBe("session");
    }
  });

  it("P3: /admin and everything under it is the admin tier", () => {
    for (const p of ["/admin", "/admin/", "/admin?q=riya", "/admin/users/5b1c", "/admin/users/5b1c#audit"]) {
      expect(routeAccess(p), p).toBe("admin");
    }
    // Lookalikes and the force-logout API (which checks the role itself) are not.
    expect(routeAccess("/administrator")).toBe("session");
    expect(routeAccess("/api/admin/force-logout")).toBe("session");
  });

  it("ignores query strings, hashes and a trailing slash", () => {
    expect(routeAccess("/login?email=a%40b.co")).toBe("public");
    expect(routeAccess("/login/reset?step=new")).toBe("public");
    expect(routeAccess("/onboarding/consent?x=1")).toBe("public");
    expect(routeAccess("/home?from=chat")).toBe("session");
    expect(routeAccess("/settings#top")).toBe("session");
    expect(routeAccess("/login/")).toBe("public");
    expect(routeAccess("/home/")).toBe("session");
  });

  it("does not treat lookalike prefixes as public", () => {
    expect(routeAccess("/loginx")).toBe("session");
    expect(routeAccess("/authx/confirm")).toBe("session");
    expect(routeAccess("/api/testing")).toBe("session");
    expect(routeAccess("/onboarding/consentx")).toBe("session");
  });
});
