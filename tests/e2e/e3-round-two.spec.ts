import { test, expect } from "@playwright/test";
import {
  FIXED_NOW,
  setClock,
  seedState,
  makeState,
  makeCompanion,
  trackHealth,
  assertHealthy,
  assertMinFontSize,
  screenshotScreen,
  answerSevenQuestions,
  driveMatchingThroughChat,
} from "./helpers";

test.describe("E3 round two end to end", () => {
  test("E3: slot-2 unlock -> gender -> 7 questions -> 15-card deck -> lock -> new chat; home shows 2 cards", async ({
    page,
  }) => {
    // Seed ONE active companion of a KNOWN templateId/gender (F01, woman), and
    // accountAt set so the account-sheet gate does not block round two.
    const companion = makeCompanion({
      id: "c_e3existing",
      templateId: "F01",
      deckGender: "woman",
      createdAt: FIXED_NOW - 500000,
    });
    const state = makeState({ companions: [companion] });

    await setClock(page, FIXED_NOW);
    await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/home");
    await page.waitForURL("**/home");
    await assertMinFontSize(page);
    await screenshotScreen(page, "e3-01-home-one-card");

    // open the add card -> intro sheet
    await page.getByRole("button", { name: "Start" }).click();
    const introDialog = page.getByRole("dialog");
    await expect(introDialog.getByText("Someone new")).toBeVisible();
    await screenshotScreen(page, "e3-02-intro-sheet");
    await introDialog.getByRole("button", { name: "Start" }).click();

    // slot-2 unlock sheet
    await expect(page.getByText("Make room for someone new")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("₹199")).toBeVisible();
    await screenshotScreen(page, "e3-03-unlock-sheet");
    await page.getByRole("button", { name: "Unlock with UPI" }).click();

    await page.waitForURL("**/onboarding/gender");
    // choose the opposite gender to get a fresh, unconstrained 15/16-card pool if desired;
    // pick "man" so the deck is a different-gender pool (still fine), but spec wants a
    // same-gender 15-card deck test explicitly, so choose woman (F01 excluded -> 15 left).
    await page.getByRole("button", { name: "A woman" }).click();
    await answerSevenQuestions(page);

    await page.waitForURL("**/onboarding/matching");
    await page.waitForTimeout(2700);
    await page.getByRole("button", { name: "Show me" }).click();

    await page.waitForURL("**/onboarding/deck");
    await expect(page.getByText(/^1 of 15$/)).toBeVisible();
    await screenshotScreen(page, "e3-04-deck-15-cards");

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
    await screenshotScreen(page, "e3-05-new-companion-chat");

    await page.getByRole("button", { name: "Back" }).click();
    await page.waitForURL("**/home");
    await screenshotScreen(page, "e3-06-home-two-cards");

    // 2 active companions -> 2 companion cards + 1 add card = 3 carousel items
    const cards = page.locator('[class*="carousel"]:not([class*="carouselWrap"]) > div');
    await expect(cards).toHaveCount(3);

    await assertMinFontSize(page);
    assertHealthy(health);
  });
});
