import { describe, it, expect } from "vitest";
import { EDIT_WINDOW_MS, canCopy, canDelete, canEdit, canRegenerate, canReply, isFresh, isSaved, nextTempId, receiptFor } from "@/lib/chatActions";
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

describe("pending bubbles", () => {
  const pending = me(-1, { pending: true });
  it("are not saved, so they have no actions", () => {
    expect(isSaved(pending)).toBe(false);
    expect(canEdit(pending, NOW)).toBe(false);
    expect(canDelete(pending)).toBe(false);
    expect(canReply(pending)).toBe(false);
    expect(canCopy(pending)).toBe(false);
  });
  it("temp ids are negative and never repeat", () => {
    const a = nextTempId();
    const b = nextTempId();
    expect(a).toBeLessThan(0);
    expect(b).toBeLessThan(0);
    expect(a).not.toBe(b);
  });
});

describe("receipt", () => {
  it("none for an empty chat or one with only her messages", () => {
    expect(receiptFor([], null)).toBeNull();
    expect(receiptFor([them(1)], null)).toBeNull();
  });
  it("delivered until she has read it (readUpTo reaches it) or answered, then read", () => {
    const list = [them(1), me(2)];
    expect(receiptFor(list, null)).toEqual({ index: 1, status: "delivered" });
    expect(receiptFor(list, 1)).toEqual({ index: 1, status: "delivered" });
    expect(receiptFor(list, 2)).toEqual({ index: 1, status: "read" });
    expect(receiptFor(list, 9)).toEqual({ index: 1, status: "read" });
    expect(receiptFor([...list, them(3)], null)).toEqual({ index: 1, status: "read" });
  });
  it("typing alone no longer means read: the dots wait for readUpTo", () => {
    expect(receiptFor([them(1), me(2)], null)?.status).toBe("delivered");
  });
  it("sits on the newest user message only", () => {
    expect(receiptFor([me(1), them(2), me(3)], null)?.index).toBe(2);
  });
  it("none when the newest user message was deleted or is still pending", () => {
    expect(receiptFor([me(1), me(2, { deleted: true })], null)).toBeNull();
    expect(receiptFor([me(1), me(-1, { pending: true })], 1)).toBeNull();
  });
});

describe("canRegenerate", () => {
  const ok = { live: true, locked: false, expired: false, playing: false };
  it("yes for the newest user message with her reply to it after", () => {
    expect(canRegenerate([me(1), them(2, { inReplyTo: 1 }), them(3, { inReplyTo: 1 })], 1, ok)).toBe(true);
  });
  it("yes when she has not replied yet", () => {
    expect(canRegenerate([them(1), me(2)], 2, ok)).toBe(true);
  });
  it("no when a newer user message follows", () => {
    expect(canRegenerate([me(1), them(2, { inReplyTo: 1 }), me(3)], 1, ok)).toBe(false);
  });
  it("no when a later bubble of hers answers something else", () => {
    expect(canRegenerate([me(1), them(2, { inReplyTo: 1 }), them(3, { inReplyTo: 9 })], 1, ok)).toBe(false);
    expect(canRegenerate([me(1), them(2)], 1, ok)).toBe(false);
  });
  it("no for an older message, her message, a missing id or a pending one", () => {
    const list = [me(1), them(2, { inReplyTo: 1 }), me(3), them(4, { inReplyTo: 3 })];
    expect(canRegenerate(list, 1, ok)).toBe(false);
    expect(canRegenerate(list, 4, ok)).toBe(false);
    expect(canRegenerate(list, 77, ok)).toBe(false);
    expect(canRegenerate([me(-1, { pending: true })], -1, ok)).toBe(false);
  });
  it("no for a mock companion, a locked one, an expired plan, or while a reply plays", () => {
    const list = [me(1), them(2, { inReplyTo: 1 })];
    expect(canRegenerate(list, 1, { ...ok, live: false })).toBe(false);
    expect(canRegenerate(list, 1, { ...ok, locked: true })).toBe(false);
    expect(canRegenerate(list, 1, { ...ok, expired: true })).toBe(false);
    expect(canRegenerate(list, 1, { ...ok, playing: true })).toBe(false);
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
