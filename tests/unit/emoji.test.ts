import { describe, it, expect } from "vitest";
import { emojiDue, hasEmoji, isJumboEmoji } from "@/lib/emoji";

describe("isJumboEmoji", () => {
  it("accepts one to three emoji", () => {
    expect(isJumboEmoji("😂")).toBe(true);
    expect(isJumboEmoji("😂😂")).toBe(true);
    expect(isJumboEmoji("🥰 😍 ❤️")).toBe(true);
  });
  it("counts a ZWJ sequence, a skin tone, a flag and a keycap as one each", () => {
    expect(isJumboEmoji("👩‍💻")).toBe(true);
    expect(isJumboEmoji("👍🏽")).toBe(true);
    expect(isJumboEmoji("🇮🇳")).toBe(true);
    expect(isJumboEmoji("1️⃣")).toBe(true);
    expect(isJumboEmoji("👩‍💻👩‍💻👩‍💻")).toBe(true);
  });
  it("rejects four emoji, text, or emoji beside text", () => {
    expect(isJumboEmoji("😂😂😂😂")).toBe(false);
    expect(isJumboEmoji("haha")).toBe(false);
    expect(isJumboEmoji("ok 😂")).toBe(false);
    expect(isJumboEmoji("1")).toBe(false);
  });
  it("rejects empty and whitespace", () => {
    expect(isJumboEmoji("")).toBe(false);
    expect(isJumboEmoji("   ")).toBe(false);
  });
});

describe("hasEmoji", () => {
  it("is false for plain text", () => {
    expect(hasEmoji("")).toBe(false);
    expect(hasEmoji("haha ok")).toBe(false);
    expect(hasEmoji("1")).toBe(false);
  });
  it("is true for an emoji beside text, a ZWJ sequence, a flag, a keycap or a jumbo bubble", () => {
    expect(hasEmoji("ok 😂")).toBe(true);
    expect(hasEmoji("👩‍💻")).toBe(true);
    expect(hasEmoji("🇮🇳")).toBe(true);
    expect(hasEmoji("1️⃣")).toBe(true);
    expect(hasEmoji("😂😂")).toBe(true);
  });
});

describe("emojiDue", () => {
  const them = (text: string, safety?: boolean) => ({ who: "them" as const, text, ...(safety ? { safety } : {}) });
  const me = (text = "hi") => ({ who: "me" as const, text });

  it("is false for empty history and for a history with no persona turns", () => {
    expect(emojiDue([])).toBe(false);
    expect(emojiDue([me(), me()])).toBe(false);
  });
  it("is false after one emoji-less reply", () => {
    expect(emojiDue([me(), them("hey")])).toBe(false);
  });
  it("is true after two emoji-less replies", () => {
    expect(emojiDue([me(), them("hey"), me(), them("what's up")])).toBe(true);
  });
  it("is false when an emoji reply follows two dry ones", () => {
    expect(emojiDue([me(), them("a"), me(), them("b"), me(), them("c 😂")])).toBe(false);
  });
  it("is false when the emoji reply sits before only one dry reply", () => {
    expect(emojiDue([me(), them("a 😂"), me(), them("b")])).toBe(false);
  });
  it("treats a multi-bubble reply as one reply, emoji in any bubble", () => {
    expect(emojiDue([me(), them("a"), me(), them("b"), them("c 😍")])).toBe(false);
    expect(emojiDue([me(), them("a"), them("b"), me(), them("c"), them("d")])).toBe(true);
  });
  it("counts two dry replies across several user turns as two replies", () => {
    expect(emojiDue([me(), them("a"), me(), me(), me(), them("b")])).toBe(true);
  });
  it("is false when the newest reply is a safety reply", () => {
    expect(emojiDue([me(), them("a"), me(), them("b"), me(), them("c", true)])).toBe(false);
  });
  it("stops counting at an older safety reply", () => {
    expect(emojiDue([me(), them("a"), me(), them("s", true), me(), them("b")])).toBe(false);
  });
  it("counts the two dry replies after a safety reply", () => {
    expect(emojiDue([me(), them("s", true), me(), them("a"), me(), them("b")])).toBe(true);
  });
});
