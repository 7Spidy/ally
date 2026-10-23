import { describe, it, expect } from "vitest";
import { isJumboEmoji } from "@/lib/emoji";

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
