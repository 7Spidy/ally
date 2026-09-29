import { describe, it, expect } from "vitest";
import { COPY, OPENERS, PRESENCE, REPLIES, openerFor, replyFor } from "@/lib/copy";

// Recursively collects every string leaf in an object/array tree.
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const v of node) collectStrings(v, out);
  } else if (node && typeof node === "object") {
    for (const v of Object.values(node)) collectStrings(v, out);
  }
  return out;
}

describe("copy", () => {
  // 44. Every §6 string appears verbatim in COPY. Transcribed directly from
  // claude_change_spec.md §6 (not from copy.ts, to avoid a tautological
  // check) — matched against COPY's actual tokens (`{a}`/`{b}` lower-case,
  // as copy.ts spells them; the spec table's markdown renders them
  // `{A}`/`{B}` but that's a table-formatting artifact of the same tokens).
  it("44. every §6 string appears verbatim somewhere in COPY", () => {
    const all = collectStrings(COPY);
    const expected = [
      "{n} left today",
      "Day pass until {time}",
      "{n} new",
      "Meet someone new",
      "A few questions, a new face. They won't know about each other.",
      "A few questions, a new face.",
      "Start",
      "That's three",
      "Three companions is the most Ally keeps at once.",
      "You've met everyone",
      "There are no new faces left to meet.",
      "Someone new",
      "The same questions as last time, minus the ones about you. Answer as you are now. Then a new set of faces.",
      "{a} won't know. Nothing you tell one companion ever reaches another.",
      "{a} and {b} won't know. Nothing you tell one companion ever reaches another.",
      "Not now",
      "Make room for someone new",
      "A second companion is a one-time unlock. The slot stays yours.",
      "A third companion is a one-time unlock. The slot stays yours.",
      "One-time",
      "₹{price}",
      "Unlock with UPI",
      "Unlocked. Let's find them.",
      "Things may have changed since last time",
      "No new faces left here",
      "Leave?",
      "Your answers won't be saved.",
      "Keep going",
      "Leave",
      "Since you left",
      "1 free message left today",
      "Get a day pass",
      "You're out of free messages for today",
      "{persona}'s done for the night. Back tomorrow.",
      "Out of messages for today",
      "Free messages come back at midnight. Or keep talking now.",
      "Day pass, 24 hours",
      "Wait till tomorrow",
      "Day pass on until {time}.",
      "Switch to",
      "Here now",
      "Home",
      "Profile",
      "Together since",
      "Notifications",
      "Message sound",
      "Part ways with {persona}",
      "Part ways with {persona}?",
      "Your chats with {obj} are deleted after 30 days. You won't be able to choose {obj} again, and this can't be undone.",
      "Type {persona} to confirm",
      "Keep {persona}",
      "Part ways",
      "Settings",
      "You",
      "Companions",
      "Plan",
      "Name",
      "Signed in with",
      "Email",
      "Free",
      "Day pass",
      "Until {time}",
      "Privacy and data",
      "How Ally works",
      "Ally is an AI. Every character here is fictional.",
      "Download my data",
      "Delete everything",
      "Delete everything?",
      "Your companions, chats and answers are removed from this device. This can't be undone.",
      "Keep my data",
      "You picked their face. The way they talk came from your answers.",
      "The questions at the start shaped how quickly they open up, how hard they push and how they handle a bad day. The first few weeks of talking can shift that a little.",
      "Each companion is separate. Nothing you tell one reaches another.",
      "None of them are real people. Ally is an AI and every character is fictional.",
      "You can download or delete your answers any time in Privacy and data.",
    ];
    const missing = expected.filter((s) => !all.includes(s));
    expect(missing, `missing strings: ${JSON.stringify(missing)}`).toEqual([]);
  });

  // 45. No user-visible string contains a core id, `%`, `score`, `level`, or
  // `2000`. Checked over COPY only — REPLIES/OPENERS are template strings
  // with `{name}` tokens but were double-checked below too, since they are
  // also user-visible (chat bubble text) even though excluded by the spec's
  // literal wording ("not over REPLIES/OPENERS").
  // The five ids are ordinary English words in places ("Money and work",
  // "friend"), so an id is only a leak when it appears as the uppercase token.
  // The rest of the banned list is checked case-insensitively, as before.
  const CORE_IDS = ["ROMANTIC", "PSYCH", "MONEY", "TRAINER", "FRIEND"];
  const OLD_CORE_IDS = ["KIAAN", "MEHER", "ANANYA", "VEER", "PRIYA", "ANAY"];
  const banned = ["%", "score", "level", "2000"];

  function expectNoLeak(label: string, strings: string[]) {
    for (const s of strings) {
      for (const id of [...CORE_IDS, ...OLD_CORE_IDS]) {
        expect(s.includes(id), `${label}: "${s}" must not contain the core id ${id}`).toBe(false);
      }
      for (const b of banned) {
        expect(s.toUpperCase().includes(b.toUpperCase()), `${label}: "${s}" must not contain "${b}"`).toBe(false);
      }
    }
  }

  it("45. no user-visible string in COPY contains a core id, %, score, level, or 2000", () => {
    expectNoLeak("COPY", collectStrings(COPY));
  });

  it("45b. REPLIES and OPENERS templates likewise never leak a core id / % / score / level / 2000", () => {
    expectNoLeak("REPLIES", collectStrings(REPLIES));
    expectNoLeak("OPENERS", collectStrings(OPENERS));
  });

  it("47. no COPY string contains an em dash (P1 D15), and phone copy is gone", () => {
    const all = collectStrings(COPY);
    for (const s of all) {
      expect(s.includes("—"), `"${s}" must not contain an em dash`).toBe(false);
      expect(/phone/i.test(s), `"${s}" must not mention a phone`).toBe(false);
    }
  });

  it("48. every P1 auth string appears verbatim in COPY", () => {
    const all = collectStrings(COPY);
    const expected = [
      "Couldn't reach Ally. Check your connection and try again.",
      "Too many tries. Wait a minute and try again.",
      "That code didn't work. Check it or ask for a new one.",
      "That code has expired. Ask for a new one.",
      "We couldn't confirm you're human. Try again.",
      "Logging in will discard what you've set up on this device. Continue?",
      "6-digit code",
      "Resend in {s}s",
      "Resend code",
      "Already have an account? Log in",
      "Send code",
      "We've sent a 6-digit code to {email}. It's valid for 10 minutes.",
      "This email already has an account. Log in instead? What you've set up here won't carry over.",
      "Log in",
      "Use another email",
      "Want a password too?",
      "You can always log in with a code instead.",
      "Save password",
      "Skip for now",
      "Welcome back",
      "Use password instead",
      "Use a code instead",
      "Password",
      "Forgot password?",
      "If an account exists for {email}, we've sent a code. It's valid for 10 minutes.",
      "Email or password is incorrect.",
      "That link didn't work. Ask for a new code instead.",
      "Reset your password",
      "New password",
      "At least 8 characters",
      "Update password",
      "Password updated. You're logged in.",
      "Account",
      "Not saved yet",
      "Save your account",
      "Set password",
      "Change password",
      "Log out",
      "Log out everywhere",
      "This logs you out on every device, including this one.",
      "Delete account",
      "This permanently deletes your account and everything in it. Type DELETE to continue.",
      "We've sent a code to {email} to confirm.",
    ];
    const missing = expected.filter((s) => !all.includes(s));
    expect(missing, `missing strings: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it("46. PRESENCE has 32 ids x 2 non-empty strings; each REPLIES pool (five cores) has exactly 4 entries", () => {
    const ids = Object.keys(PRESENCE);
    expect(ids.length).toBe(32);
    for (const id of ids) {
      const entry = PRESENCE[id];
      expect(entry.day.length, `${id}.day`).toBeGreaterThan(0);
      expect(entry.night.length, `${id}.night`).toBeGreaterThan(0);
    }
    // 16 F-ids, 16 M-ids
    expect(ids.filter((id) => id.startsWith("F")).length).toBe(16);
    expect(ids.filter((id) => id.startsWith("M")).length).toBe(16);

    const cores = Object.keys(REPLIES) as (keyof typeof REPLIES)[];
    expect(cores.length).toBe(5);
    for (const core of cores) {
      expect(REPLIES[core].length, core).toBe(4);
      for (const r of REPLIES[core]) expect(r.length, `${core} reply`).toBeGreaterThan(0);
    }
  });

  it("49. B1: OPENERS and REPLIES are keyed by exactly the five new core ids, with all six pressures", () => {
    const ids = ["FRIEND", "MONEY", "PSYCH", "ROMANTIC", "TRAINER"];
    expect(Object.keys(OPENERS).sort()).toEqual(ids);
    expect(Object.keys(REPLIES).sort()).toEqual(ids);
    for (const id of ids) {
      expect(Object.keys(OPENERS[id as keyof typeof OPENERS]).sort()).toEqual(["alone", "change", "head", "health", "money", "notgood"]);
    }
    expect(openerFor("PSYCH", "head", "Sam")).toContain("Sam");
    expect(replyFor("TRAINER", 5)).toBe(REPLIES.TRAINER[0]);
  });

  it("50. B1: the card questions and the tiebreaker carry the exact spec copy", () => {
    expect(COPY.q6).toEqual({ question: "A good conversation ends with", options: ["Feeling understood", "Feeling lighter", "Seeing it clearly", "Knowing what to do"] });
    expect(COPY.q7).toEqual({
      question: "When you're stuck, what actually gets you moving?",
      options: ["Someone patient", "Someone who believes in me", "Someone who makes it fun", "Someone who won't let it go"],
    });
    expect(COPY.q9).toEqual({
      question: "When something's off, what do you want most?",
      options: ["Help understanding it", "Help forgetting it for an hour", "Someone to just stay", "A way to fix it, today"],
    });
    expect(COPY.q5.options).toEqual(["I keep it to myself", "I tell one person", "I need to say it out loud", "Everyone hears about it"]);
    expect(COPY.q8.options).toEqual(["Open, I'll see what happens", "Loosely sketched", "Mostly planned", "Every hour accounted for"]);
    for (const q of [COPY.q5, COPY.q6, COPY.q7, COPY.q8, COPY.q9]) expect(q.options.length).toBe(4);
    expect(COPY.tiebreak.question).toBe("It's 11pm and it's been a rough day. Which message would you rather get?");
    expect(COPY.tiebreak.lines).toEqual({
      ROMANTIC: "you went quiet today. i noticed. tell me the part you didn't say.",
      PSYCH: "Let's slow it down. What's the thought that keeps coming back?",
      FRIEND: "okay. emergency snacks and a terrible movie. then you tell me everything",
      MONEY: "Right. List what's actually urgent. We'll sort the rest tomorrow.",
      TRAINER: "Water. Shoes on. Ten-minute walk. Then we talk.",
    });
    expect(COPY.tutorial.keep).toBe("Swipe right to keep");
    expect(COPY.tutorial.pass).toBe("Swipe left to pass");
  });
});
