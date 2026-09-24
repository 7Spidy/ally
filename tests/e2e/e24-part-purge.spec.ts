import { test, expect } from "@playwright/test";
import {
  FIXED_NOW,
  setClock,
  seedState,
  makeState,
  makeCompanion,
  trackHealth,
  assertHealthy,
  screenshotScreen,
  serverSnapshot,
  adminClient,
} from "./helpers";

const DAY_MS = 86400000;

test.describe("E24 part, then the server-side 30-day purge", () => {
  test("E24: parting sets purge_at 30 days out; once purge_at has passed, the next load purges the conversation but keeps the face excluded", async ({
    page,
  }) => {
    const history = [
      { who: "them" as const, text: "Hey.", at: FIXED_NOW - 400000 },
      { who: "me" as const, text: "Hi Noor", at: FIXED_NOW - 300000 },
    ];
    const c1 = makeCompanion({ id: "c_e24a", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 900000 });
    const c2 = makeCompanion({ id: "c_e24b", templateId: "F02", deckGender: "woman", createdAt: FIXED_NOW - 800000, messages: history, exchanges: 1 });
    const state = makeState({
      companions: [c1, c2],
      ledger: { slotsUnlocked: 2, unlocks: [{ slot: 2, at: FIXED_NOW - 850000, amount: 199 }] },
    });

    await setClock(page, FIXED_NOW);
    const userId = await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/profile/c_e24b");
    await page.getByRole("button", { name: /Part ways with/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Type .* to confirm/).fill("Noor");
    const before = Date.now();
    await dialog.getByRole("button", { name: "Part ways" }).click();
    await page.waitForURL("**/home");
    await expect(page.getByText("Noor")).not.toBeVisible();

    // Server: parted, purge_at 30 days after parted_at, face excluded, history intact for now.
    let snap = await serverSnapshot(userId);
    const parted = snap.companions.find((c) => c.id === "c_e24b")!;
    expect(parted.status).toBe("parted");
    const partedAt = Date.parse(parted.parted_at as string);
    const purgeAt = Date.parse(parted.purge_at as string);
    expect(purgeAt - partedAt).toBe(30 * DAY_MS);
    expect(partedAt).toBeGreaterThan(before - 60000);
    expect(snap.parted).toEqual(["F02"]);
    expect(snap.messages.filter((m) => m.companion_id === "c_e24b")).toHaveLength(2);

    // Fast-forward by moving purge_at into the past (the server's clock can't be skewed).
    const moved = await adminClient()
      .from("companions")
      .update({ purge_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", "c_e24b");
    expect(moved.error).toBeNull();

    // The next load runs get_my_state, which purges first.
    await page.reload();
    await page.waitForURL("**/home");
    await expect(page.locator('[class*="carousel"]:not([class*="carouselWrap"]) > div')).toHaveCount(2); // Ira + add card
    await screenshotScreen(page, "e24-01-home-after-purge");

    snap = await serverSnapshot(userId);
    const purged = snap.companions.find((c) => c.id === "c_e24b")!;
    expect(purged.status).toBe("parted");
    expect(purged.core).toEqual({ primary: null, secondary: null, weight: null, ranked: [] });
    expect(purged.unread).toBe(0);
    expect(snap.messages.filter((m) => m.companion_id === "c_e24b")).toHaveLength(0);
    // Ira's conversation is untouched, and Noor's face stays excluded for good.
    expect(snap.messages.filter((m) => m.companion_id === "c_e24a").length).toBeGreaterThan(0);
    expect(snap.parted).toEqual(["F02"]);

    assertHealthy(health);
  });
});
