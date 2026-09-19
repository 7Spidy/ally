import { test, expect } from "@playwright/test";
import {
  FIXED_NOW,
  setClock,
  trackHealth,
  assertHealthy,
  assertMinFontSize,
  assertNoSpinner,
  screenshotScreen,
  driveFirstRunIntro,
  answerSevenQuestions,
  driveMatchingThroughChat,
} from "./helpers";

test.describe("E1 fresh first run to first chat", () => {
  test("E1: first run -> onboarding -> chat -> back to home shows one card + peeking add card", async ({ page }) => {
    await setClock(page, FIXED_NOW);
    const health = trackHealth(page);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
    await assertMinFontSize(page);
    await screenshotScreen(page, "e1-01-splash-first");
    await page.getByRole("button", { name: "Get started" }).click();

    await page.waitForURL("**/onboarding/consent");
    await assertNoSpinner(page);
    await screenshotScreen(page, "e1-02-consent");

    await driveFirstRunIntro(page, { name: "Riya", city: "Mumbai", gender: "woman" });
    await answerSevenQuestions(page);
    await driveMatchingThroughChat(page);

    // landed on chat
    await expect(page).toHaveURL(/\/chat\/c_/);
    await assertNoSpinner(page);
    await screenshotScreen(page, "e1-03-first-chat");

    // back to home via the chat header back button
    await page.getByRole("button", { name: "Back" }).click();
    await page.waitForURL("**/home");
    await assertNoSpinner(page);
    await screenshotScreen(page, "e1-04-home-one-card");

    // one companion card + peeking add card in the DOM
    await expect(page.getByText("Meet someone new")).toBeAttached();
    const cards = page.locator('[class*="carousel"]:not([class*="carouselWrap"]) > div');
    await expect(cards).toHaveCount(2);

    await assertMinFontSize(page);
    assertHealthy(health);
  });
});
