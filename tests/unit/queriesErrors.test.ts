import { describe, it, expect } from "vitest";
import { rpcErrorMessage } from "@/lib/supabase/queries";
import { COPY } from "@/lib/copy";

describe("rpcErrorMessage for the B3 actions", () => {
  it("maps each edit rule to its own line", () => {
    expect(rpcErrorMessage({ message: "edit_window_closed" })).toBe(COPY.chat.editWindowClosed);
    expect(rpcErrorMessage({ message: "edit_limit" })).toBe(COPY.chat.editLimit);
  });
  it("a message that is gone, deleted, or a quote that vanished shares one line", () => {
    for (const m of ["message_deleted", "message_not_found", "quote_not_found"]) expect(rpcErrorMessage({ message: m })).toBe(COPY.chat.messageGone);
  });
  it("suspension and the network line are unchanged", () => {
    expect(rpcErrorMessage({ message: "account_suspended" })).toBe(COPY.auth.suspended);
    expect(rpcErrorMessage(new Error("boom"))).toBe(COPY.auth.network);
  });
});
