import { describe, it, expect } from "vitest";
import { shouldPromptName } from "@/lib/namePrompt";
import { checkName, normaliseName } from "@/lib/nameCheck";
import { freshState } from "@/state/schema";

const base = freshState(1_700_000_000_000, "2026-01-01");
const withCompanion = { ...base, companions: [{ id: "c_1" } as never] };

describe("shouldPromptName", () => {
  const ok = { ready: true, hasSession: true, state: withCompanion, pathname: "/home" };
  it("shows for a nameless user with a companion on app routes", () => {
    for (const pathname of ["/home", "/chat/c_1", "/settings", "/profile/F01"]) expect(shouldPromptName({ ...ok, pathname })).toBe(true);
  });
  it("hides while loading, signed out, named, mid-onboarding, or on excluded routes", () => {
    expect(shouldPromptName({ ...ok, ready: false })).toBe(false);
    expect(shouldPromptName({ ...ok, hasSession: false })).toBe(false);
    expect(shouldPromptName({ ...ok, state: { ...withCompanion, user: { ...withCompanion.user, displayName: "Rhea" } } })).toBe(false);
    expect(shouldPromptName({ ...ok, state: base })).toBe(false);
    for (const pathname of ["/onboarding/name", "/login", "/auth/callback", "/blocked", "/admin/users"]) expect(shouldPromptName({ ...ok, pathname })).toBe(false);
  });
  it("shows for an account holder with no companion yet", () => {
    const s = { ...base, user: { ...base.user, accountAt: 1 } };
    expect(shouldPromptName({ ...ok, state: s })).toBe(true);
  });
});

describe("checkName", () => {
  it("accepts real names and normalises them", () => {
    for (const n of ["Rhea", "D'Souza", "Mary Ann", "Anne-Marie", "Zoë", "  Ravi   Kumar  "]) expect(checkName(n).ok, n).toBe(true);
    expect(normaliseName("  D’Souza  ")).toBe("D'Souza");
  });
  it("rejects with the first failing problem", () => {
    const p = (n: string) => { const r = checkName(n); return r.ok ? "ok" : r.problem; };
    expect(p("   ")).toBe("empty");
    expect(p("A")).toBe("short");
    expect(p("A".repeat(25))).toBe("long");
    expect(p("Rhea1")).toBe("chars");
    expect(p("Rh😀")).toBe("chars");
    expect(p("-Rhea")).toBe("shape");
    expect(p("Rhea-")).toBe("shape");
    expect(p("Ann--e")).toBe("shape");
    expect(p("Aaaaaa")).toBe("repeat");
    expect(p("Test")).toBe("placeholder");
  });
});
