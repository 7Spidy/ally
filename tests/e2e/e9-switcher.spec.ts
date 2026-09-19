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
} from "./helpers";

test.describe("E9 switcher via long-press + overflow Home", () => {
  test("E9: long-press avatar opens switcher; picking a companion opens its chat; overflow Home -> /home", async ({
    page,
  }) => {
    const c1 = makeCompanion({ id: "c_e9a", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 900000 });
    const c2 = makeCompanion({ id: "c_e9b", templateId: "M01", deckGender: "man", createdAt: FIXED_NOW - 800000 });
    const state = makeState({
      companions: [c1, c2],
      ledger: { slotsUnlocked: 2, unlocks: [{ slot: 2, at: FIXED_NOW - 850000, amount: 199 }] },
    });

    await setClock(page, FIXED_NOW);
    await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/chat/c_e9a");
    await page.waitForURL("**/chat/c_e9a");
    await expect(page.getByText("Ira")).toBeVisible();

    const avatarBtn = page.locator('[class*="identity"]');
    const box = await avatarBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(650); // > LONG_PRESS_MS (500ms)
      await page.mouse.up();
    }

    const switcherDialog = page.getByRole("dialog");
    await expect(switcherDialog.getByText("Switch to")).toBeVisible({ timeout: 3000 });
    await screenshotScreen(page, "e9-01-switcher-sheet");
    await switcherDialog.getByText("Arjun").click();

    await page.waitForURL("**/chat/c_e9b");
    await expect(page.getByText("Arjun")).toBeVisible();
    await screenshotScreen(page, "e9-02-switched-chat");

    // overflow -> Home
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Home" }).click();
    await page.waitForURL("**/home");
    await screenshotScreen(page, "e9-03-home-via-overflow");

    assertHealthy(health);
  });
});
