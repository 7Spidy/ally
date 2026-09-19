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
  answerSevenQuestions,
} from "./helpers";

test.describe("E4 third companion hits slot-3 unlock, then home shows cap card", () => {
  test("E4: slot-3 unlock at the higher price -> lock third companion -> cap card", async ({ page }) => {
    const c1 = makeCompanion({ id: "c_e4a", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 900000 });
    const c2 = makeCompanion({ id: "c_e4b", templateId: "M01", deckGender: "man", createdAt: FIXED_NOW - 800000 });
    const state = makeState({
      companions: [c1, c2],
      ledger: { slotsUnlocked: 2, unlocks: [{ slot: 2, at: FIXED_NOW - 850000, amount: 199 }] },
    });

    await setClock(page, FIXED_NOW);
    await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/home");
    await page.waitForURL("**/home");

    await page.getByRole("button", { name: "Start" }).click();
    const introDialog = page.getByRole("dialog");
    await introDialog.getByRole("button", { name: "Start" }).click();

    // slot-3 unlock, higher price than slot-2's 199
    await expect(page.getByText("Make room for someone new")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("₹349")).toBeVisible();
    await screenshotScreen(page, "e4-01-unlock-slot3");
    await page.getByRole("button", { name: "Unlock with UPI" }).click();

    await page.waitForURL("**/onboarding/gender");
    await page.getByRole("button", { name: "A woman" }).click();
    await answerSevenQuestions(page);

    await page.waitForURL("**/onboarding/matching");
    await page.waitForTimeout(2700);
    await page.getByRole("button", { name: "Show me" }).click();

    await page.waitForURL("**/onboarding/deck");
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(150);
    }
    await page.getByRole("button", { name: "Done" }).click({ timeout: 10000 });

    await page.waitForURL("**/onboarding/proposal");
    await page.getByRole("button", { name: "Lock them in" }).click();
    await page.getByRole("button", { name: "Yes, it's them" }).click();
    await page.waitForURL("**/onboarding/reveal");
    await page.locator('[role="button"][aria-label="Continue"]').click();
    await page.waitForURL(/\/chat\/c_/, { timeout: 15000 });

    await page.getByRole("button", { name: "Back" }).click();
    await page.waitForURL("**/home");
    await screenshotScreen(page, "e4-02-home-cap-card");

    await expect(page.getByText("That's three")).toBeVisible();
    await expect(page.getByText("Three companions is the most Ally keeps at once.")).toBeVisible();

    assertHealthy(health);
  });
});
