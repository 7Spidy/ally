import { describe, it, expect } from "vitest";
import { EDIT_WINDOW_MS, canCopy, canDelete, canEdit, canReply, isFresh, receiptFor } from "@/lib/chatActions";
import type { Message } from "@/state/schema";

const NOW = 1_800_000_000_000;
const me = (id: number, over: Partial<Message> = {}): Message => ({ id, who: "me", text: "hi", at: NOW - 1000, ...over });
const them = (id: number, over: Partial<Message> = {}): Message => ({ id, who: "them", text: "hey", at: NOW - 500, ...over });

describe("edit", () => {
  it("is for your own saved messages inside 15 minutes", () => {
    expect(canEdit(me(1), NOW)).toBe(true);
    expect(canEdit(me(1, { at: NOW - EDIT_WINDOW_MS }), NOW)).toBe(true);
    expect(canEdit(me(1, { at: NOW - EDIT_WINDOW_MS - 1 }), NOW)).toBe(false);
  });
  it("is never offered on her messages, deleted ones, or unsaved bubbles", () => {
    expect(canEdit(them(2), NOW)).toBe(false);
    expect(canEdit(me(1, { deleted: true }), NOW)).toBe(false);
    expect(canEdit({ who: "me", text: "x", at: NOW }, NOW)).toBe(false);
    expect(canEdit(me(-5), NOW)).toBe(false);
  });
});

describe("delete, reply, copy", () => {
  it("delete and reply work on either side, once saved and not already deleted", () => {
    for (const m of [me(1), them(2)]) {
      expect(canDelete(m)).toBe(true);
      expect(canReply(m)).toBe(true);
    }
    expect(canDelete(me(1, { deleted: true }))).toBe(false);
    expect(canReply(them(2, { deleted: true }))).toBe(false);
    expect(canDelete(me(-1))).toBe(false);
  });
  it("copy needs text", () => {
    expect(canCopy(me(1))).toBe(true);
    expect(canCopy(me(1, { text: "", deleted: true }))).toBe(false);
  });
});

describe("receipt", () => {
  it("none for an empty chat or one with only her messages", () => {
    expect(receiptFor([], false)).toBeNull();
    expect(receiptFor([them(1)], false)).toBeNull();
  });
  it("delivered until she types or answers, then read", () => {
    const list = [them(1), me(2)];
    expect(receiptFor(list, false)).toEqual({ index: 1, status: "delivered" });
    expect(receiptFor(list, true)).toEqual({ index: 1, status: "read" });
    expect(receiptFor([...list, them(3)], false)).toEqual({ index: 1, status: "read" });
  });
  it("sits on the newest user message only", () => {
    expect(receiptFor([me(1), them(2), me(3)], false)?.index).toBe(2);
  });
  it("none when the newest user message was deleted", () => {
    expect(receiptFor([me(1), me(2, { deleted: true })], false)).toBeNull();
  });
});

describe("fresh", () => {
  it("is a saved message not present at first render", () => {
    const initial = new Set([1, 2]);
    expect(isFresh(me(2), initial)).toBe(false);
    expect(isFresh(them(3), initial)).toBe(true);
    expect(isFresh({ who: "them", text: "x", at: 1 }, initial)).toBe(false);
  });
});
