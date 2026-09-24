import { test, expect } from "@playwright/test";
import { FIXED_NOW, setClock, seedState, makeState, makeCompanion, trackHealth, assertHealthy, screenshotScreen, assertMinFontSize, stateKeyFor } from "./helpers";

test.describe("E6 part with everyone -> zero state", () => {
  test("E6: reload after parting everyone shows returning splash then home zero state", async ({ page }) => {
    const c1 = makeCompanion({ id: "c_e6a", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 900000 });
    const c2 = makeCompanion({ id: "c_e6b", templateId: "M01", deckGender: "man", createdAt: FIXED_NOW - 800000 });
    // Both already parted (part flow itself is covered end-to-end by E5).
    const parted = (c: ReturnType<typeof makeCompanion>) => ({
      ...c,
      status: "parted" as const,
      partedAt: FIXED_NOW - 1000,
      purgeAt: FIXED_NOW + 29 * 86400000,
    });
    const state = makeState({
      companions: [parted(c1), parted(c2)],
      ledger: { slotsUnlocked: 2, parted: ["F01", "M01"], unlocks: [{ slot: 2, at: FIXED_NOW - 850000, amount: 199 }] },
    });

    await setClock(page, FIXED_NOW);
    const userId = await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/");
    await page.waitForURL("**/home", { timeout: 5000 });
    await screenshotScreen(page, "e6-01-home-zero-state");

    // zero-companion state: only the add card, centred, only the + pip
    const cards = page.locator('[class*="carousel"]:not([class*="carouselWrap"]) > div');
    await expect(cards).toHaveCount(1);
    await expect(page.getByText("Meet someone new")).toBeVisible();
    await expect(page.getByText("A few questions, a new face.", { exact: false })).toBeVisible();
    await assertMinFontSize(page);

    // P2: the parted companions exist only in the server tables; the local
    // blob the app read holds no companions, so the zero state above was
    // derived from get_my_state.
    const local = JSON.parse((await page.evaluate((k) => window.localStorage.getItem(k), stateKeyFor(userId))) as string);
    expect(local.companions).toEqual([]);
    expect(local.ledger.parted).toEqual([]);

    assertHealthy(health);
  });
});
