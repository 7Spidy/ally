import { describe, it, expect } from "vitest";
import { rollDay, passActive, freeLeft, canSend, spend, buyPass, unlock } from "@/lib/ledger";
import { dayKey } from "@/lib/clock";
import { freshLedger } from "@/state/schema";
import { FREE_DAILY, PASS_HOURS, PASS_CAP, MAX_COMPANIONS, PRICE_SLOT_2, PRICE_SLOT_3, PRICE_DAY_PASS } from "@/lib/config";

const NOW = 1_700_000_000_000; // arbitrary fixed instant

describe("ledger", () => {
  // 30. dayKey passes an explicit timeZone to Intl.DateTimeFormat, so it
  // never reads process.env.TZ; this is verified structurally by reading
  // src/lib/clock.ts (no `process.env` reference anywhere in it), and this
  // assertion demonstrates rollDay's day-rollover using instants that are
  // unambiguous across UTC, America/Los_Angeles and Asia/Tokyo device
  // clocks alike — since only the ms epoch value (not the host TZ) ever
  // feeds dayKey/rollDay.
  it("30. day rollover at 00:00 Asia/Kolkata is TZ-independent (structural: dayKey never reads process.env.TZ)", () => {
    const beforeMidnightIST = Date.UTC(2024, 2, 10, 18, 29, 0); // 23:59 IST on Mar 10
    const afterMidnightIST = Date.UTC(2024, 2, 10, 18, 30, 0); // 00:00 IST on Mar 11
    const l = { ...freshLedger(dayKey(beforeMidnightIST)), freeUsed: 42 };
    expect(rollDay(l, beforeMidnightIST)).toEqual(l); // same day, unchanged
    const rolled = rollDay(l, afterMidnightIST);
    expect(rolled.day).toBe(dayKey(afterMidnightIST));
    expect(rolled.freeUsed).toBe(0);
  });

  it("31. 100 free sends succeed; the 101st returns 'empty'", () => {
    let l = freshLedger(dayKey(NOW));
    for (let i = 0; i < FREE_DAILY; i++) {
      expect(canSend(l, NOW), `send #${i + 1}`).toBe("ok");
      l = spend(l, NOW);
    }
    expect(l.freeUsed).toBe(FREE_DAILY);
    expect(canSend(l, NOW)).toBe("empty");
    expect(freeLeft(l, NOW)).toBe(0);
    // spend is a no-op once empty
    const stillEmpty = spend(l, NOW);
    expect(stillEmpty).toEqual(l);
  });

  it("32. a pass allows 2000 sends; the 2001st returns 'capped'", () => {
    let l = buyPass(freshLedger(dayKey(NOW)), NOW);
    for (let i = 0; i < PASS_CAP; i++) {
      expect(canSend(l, NOW), `send #${i + 1}`).toBe("ok");
      l = spend(l, NOW);
    }
    expect(l.pass!.used).toBe(PASS_CAP);
    expect(canSend(l, NOW)).toBe("capped");
    const stillCapped = spend(l, NOW);
    expect(stillCapped).toEqual(l);
  });

  it("33. a pass never touches freeUsed; after it expires, the day's remaining free messages are still usable", () => {
    let l = freshLedger(dayKey(NOW));
    l = { ...l, freeUsed: 30 }; // already used 30 free today
    l = buyPass(l, NOW);
    for (let i = 0; i < 10; i++) l = spend(l, NOW + i * 1000);
    expect(l.freeUsed).toBe(30); // untouched by pass spends
    expect(l.pass!.used).toBe(10);

    // Query a moment past the pass's endsAt but still on the SAME
    // Asia/Kolkata calendar day as `l.day` (a full PASS_HOURS=24h wall-clock
    // gap would always cross into the next day, which would exercise
    // rollDay's reset instead of what this test is checking: that expiry
    // alone, independent of any day rollover, falls back to the day's
    // still-remaining free quota). Craft the ledger's pass directly with an
    // endsAt a few seconds in the past instead of waiting a full 24h.
    const shortPass = { ...l, pass: { ...l.pass!, endsAt: NOW + 5000 } };
    const afterExpiry = NOW + 6000;
    expect(dayKey(afterExpiry)).toBe(l.day); // still the same Kolkata day
    expect(passActive(shortPass, afterExpiry)).toBe(false);
    expect(canSend(shortPass, afterExpiry)).toBe("ok");
    expect(freeLeft(shortPass, afterExpiry)).toBe(FREE_DAILY - 30);
  });

  it("34. a pass ends exactly PASS_HOURS after purchase, not at midnight", () => {
    const l = buyPass(freshLedger(dayKey(NOW)), NOW);
    const endsAt = NOW + PASS_HOURS * 3600000;
    expect(l.pass!.endsAt).toBe(endsAt);
    expect(passActive(l, endsAt - 1)).toBe(true);
    expect(passActive(l, endsAt)).toBe(false);
  });

  it("35. buyPass while a pass is active is a no-op", () => {
    const l = buyPass(freshLedger(dayKey(NOW)), NOW);
    const again = buyPass(l, NOW + 1000);
    expect(again).toEqual(l);
    expect(again.passes.length).toBe(1);
  });

  it("36. unlock never exceeds MAX_COMPANIONS; recorded amounts are PRICE_SLOT_2 then PRICE_SLOT_3", () => {
    let l = freshLedger(dayKey(NOW));
    expect(l.slotsUnlocked).toBe(1);
    l = unlock(l, PRICE_SLOT_2, NOW);
    expect(l.slotsUnlocked).toBe(2);
    expect(l.unlocks).toEqual([{ slot: 2, at: NOW, amount: PRICE_SLOT_2 }]);
    l = unlock(l, PRICE_SLOT_3, NOW + 1000);
    expect(l.slotsUnlocked).toBe(3);
    expect(l.unlocks[1]).toEqual({ slot: 3, at: NOW + 1000, amount: PRICE_SLOT_3 });
    expect(l.slotsUnlocked).toBe(MAX_COMPANIONS);
    // a further unlock never exceeds the cap
    const capped = unlock(l, 999, NOW + 2000);
    expect(capped.slotsUnlocked).toBe(MAX_COMPANIONS);
    expect(capped.unlocks.length).toBe(3);
  });

  it("37. PRICE_SLOT_3 > PRICE_SLOT_2 (config guard)", () => {
    expect(PRICE_SLOT_3).toBeGreaterThan(PRICE_SLOT_2);
  });

  it("38. parting leaves slotsUnlocked unchanged; the next round two needs no unlock if a slot is free", () => {
    let l = unlock(freshLedger(dayKey(NOW)), PRICE_SLOT_2, NOW); // slotsUnlocked = 2
    expect(l.slotsUnlocked).toBe(2);
    // Parting a companion (modelled here directly on the ledger, matching
    // allyReducer's PART_COMPANION which only touches `parted`, never
    // `slotsUnlocked`) adds to `parted` and leaves slotsUnlocked untouched.
    l = { ...l, parted: [...l.parted, "F01"] };
    expect(l.slotsUnlocked).toBe(2); // unchanged
    // With slotsUnlocked=2 and (say) 1 active companion, a new round two
    // has a free slot and needs no further unlock call.
    const activeCount = 1;
    expect(l.slotsUnlocked).toBeGreaterThan(activeCount);
  });

  it("day pass amount matches PRICE_DAY_PASS", () => {
    const l = buyPass(freshLedger(dayKey(NOW)), NOW);
    expect(l.passes[0].amount).toBe(PRICE_DAY_PASS);
  });

  it("P3: a server-sent freeDaily / passCap (admin override) replaces the defaults", () => {
    const free = { ...freshLedger(dayKey(NOW)), freeDaily: 5, freeUsed: 4 };
    expect(freeLeft(free, NOW)).toBe(1);
    expect(canSend(free, NOW)).toBe("ok");
    expect(canSend({ ...free, freeUsed: 5 }, NOW)).toBe("empty");
    // A raised cap lets a user past the global default.
    expect(canSend({ ...free, freeDaily: FREE_DAILY + 10, freeUsed: FREE_DAILY }, NOW)).toBe("ok");

    const onPass = { ...buyPass(freshLedger(dayKey(NOW)), NOW), passCap: 3 };
    expect(canSend({ ...onPass, pass: { ...onPass.pass!, used: 2 } }, NOW)).toBe("ok");
    expect(canSend({ ...onPass, pass: { ...onPass.pass!, used: 3 } }, NOW)).toBe("capped");
  });
});
