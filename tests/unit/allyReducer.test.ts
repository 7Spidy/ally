import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { allyReducer } from "@/state/allyReducer";
import { freshState, freshLedger, emptyAnswers, type AllyState, type Companion, type Ledger } from "@/state/schema";
import { localOnly } from "@/lib/migrate";

// P2 (spec D6, §6.2): server-owned actions apply the RPC's confirmed values
// verbatim; the reducer never computes a ledger or companion itself.
const NOW = 1_700_000_000_000;
const DAY = "2023-11-15";

function companion(over: Partial<Companion> = {}): Companion {
  return {
    id: "c_test",
    templateId: "F01",
    deckGender: "woman",
    answers: emptyAnswers(),
    core: { primary: "MEHER", secondary: null, weight: 100, ranked: [] },
    createdAt: NOW - 1000,
    lastOpenedAt: NOW - 1000,
    status: "active",
    partedAt: null,
    purgeAt: null,
    messages: [],
    exchanges: 0,
    unread: 0,
    notify: true,
    sound: true,
    ...over,
  };
}

function stateWith(c: Companion): AllyState {
  return { ...freshState(NOW, DAY), companions: [c], flow: null };
}

const serverLedger: Ledger = {
  ...freshLedger(DAY),
  freeUsed: 37,
  slotsUnlocked: 2,
  unlocks: [{ slot: 2, at: NOW, amount: 199 }],
  parted: ["M04"],
};

describe("allyReducer: server-confirmed actions", () => {
  it("SEND_MESSAGE appends the returned message and takes exchanges and ledger from the server", () => {
    const s = stateWith(companion({ exchanges: 4 }));
    const message = { who: "me" as const, text: "hi", at: NOW + 5 };
    const next = allyReducer(s, { type: "SEND_MESSAGE", companionId: "c_test", message, exchanges: 9, ledger: serverLedger });
    expect(next.companions[0].messages).toEqual([message]);
    expect(next.companions[0].exchanges).toBe(9); // not 4 + 1
    expect(next.ledger).toBe(serverLedger);
  });

  it("LEDGER_SYNC (a blocked send) replaces only the ledger", () => {
    const s = stateWith(companion());
    const next = allyReducer(s, { type: "LEDGER_SYNC", ledger: serverLedger });
    expect(next.ledger).toBe(serverLedger);
    expect(next.companions).toBe(s.companions);
  });

  it("RECEIVE_REPLY appends the stored reply and bumps unread", () => {
    const s = stateWith(companion({ unread: 1 }));
    const message = { who: "them" as const, text: "reply", at: NOW + 9 };
    const next = allyReducer(s, { type: "RECEIVE_REPLY", companionId: "c_test", message });
    expect(next.companions[0].messages).toEqual([message]);
    expect(next.companions[0].unread).toBe(2);
  });

  it("SEED_OPENER only lands in an empty conversation", () => {
    const opener = { who: "them" as const, text: "opener", at: NOW };
    const empty = allyReducer(stateWith(companion()), { type: "SEED_OPENER", companionId: "c_test", message: opener });
    expect(empty.companions[0].messages).toEqual([opener]);
    expect(empty.companions[0].unread).toBe(1);
    const again = allyReducer(empty, { type: "SEED_OPENER", companionId: "c_test", message: { ...opener, text: "second" } });
    expect(again).toBe(empty);
  });

  it("OPEN_CHAT uses the server's last_opened_at and clears unread", () => {
    const next = allyReducer(stateWith(companion({ unread: 3 })), { type: "OPEN_CHAT", companionId: "c_test", lastOpenedAt: NOW + 42 });
    expect(next.companions[0]).toMatchObject({ lastOpenedAt: NOW + 42, unread: 0 });
  });

  it("PART_COMPANION applies the server's dates and ledger", () => {
    const next = allyReducer(stateWith(companion()), {
      type: "PART_COMPANION",
      companionId: "c_test",
      partedAt: NOW,
      purgeAt: NOW + 123,
      ledger: serverLedger,
    });
    expect(next.companions[0]).toMatchObject({ status: "parted", partedAt: NOW, purgeAt: NOW + 123 });
    expect(next.ledger).toBe(serverLedger);
  });

  it("UNLOCK_SLOT and BUY_PASS replace the ledger with the server's", () => {
    const s = stateWith(companion());
    expect(allyReducer(s, { type: "UNLOCK_SLOT", ledger: serverLedger }).ledger).toBe(serverLedger);
    const withPass = { ...serverLedger, pass: { startedAt: NOW, endsAt: NOW + 1, used: 0 } };
    expect(allyReducer(s, { type: "BUY_PASS", ledger: withPass }).ledger).toBe(withPass);
  });

  it("CONFIRM_LOCK appends the server companion, clears the flow and keeps the flow's display name", () => {
    const s: AllyState = { ...freshState(NOW, DAY), flow: { ...freshState(NOW, DAY).flow!, displayName: "Riya" } };
    const c = companion({ id: "c_server" });
    const next = allyReducer(s, { type: "CONFIRM_LOCK", companion: c });
    expect(next.companions).toEqual([c]);
    expect(next.flow).toBeNull();
    expect(next.user.displayName).toBe("Riya");
  });

  it("the reducer no longer imports the ledger math (it never computes a ledger itself)", () => {
    const src = readFileSync(path.join(__dirname, "../../src/state/allyReducer.ts"), "utf8");
    expect(src).not.toMatch(/from "@\/lib\/ledger"/);
    expect(src).not.toMatch(/replyFor/);
  });
});

describe("localOnly", () => {
  it("drops companions and the ledger but keeps flow and user", () => {
    const s: AllyState = { ...stateWith(companion()), ledger: serverLedger, user: { ...freshState(NOW, DAY).user, displayName: "Riya" } };
    const out = localOnly(s, "2026-09-24");
    expect(out.companions).toEqual([]);
    expect(out.ledger).toEqual(freshLedger("2026-09-24"));
    expect(out.user.displayName).toBe("Riya");
    expect(out.flow).toBe(s.flow);
  });
});
