import { test, expect } from "@playwright/test";
import {
  FIXED_NOW,
  setClock,
  seedState,
  makeState,
  makeCompanion,
  trackHealth,
  assertHealthy,
  driveFirstRunIntro,
  answerSevenQuestions,
  driveMatchingThroughChat,
} from "./helpers";

test.describe("E11 prefers-reduced-motion", () => {
  test("E11a: first run (E1) completes under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setClock(page, FIXED_NOW);
    const health = trackHealth(page);

    await page.goto("/");
    await page.getByRole("button", { name: "Get started" }).click();
    await page.waitForURL("**/onboarding/consent");

    await driveFirstRunIntro(page, { name: "Meera", city: "Pune", gender: "man" });
    await answerSevenQuestions(page);
    await driveMatchingThroughChat(page, { reducedMotion: true });

    await expect(page).toHaveURL(/\/chat\/c_/);
    assertHealthy(health);
  });

  test("E11b: round two (E3) completes under reduced motion", async ({ page }) => {
    const companion = makeCompanion({
      id: "c_e11existing",
      templateId: "F01",
      deckGender: "woman",
      createdAt: FIXED_NOW - 500000,
    });
    const state = makeState({ companions: [companion] });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await setClock(page, FIXED_NOW);
    await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/home");
    await page.waitForURL("**/home");

    await page.getByRole("button", { name: "Start" }).click();
    const introDialog = page.getByRole("dialog");
    await introDialog.getByRole("button", { name: "Start" }).click();

    await expect(page.getByText("Make room for someone new")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Unlock with UPI" }).click();

    await page.waitForURL("**/onboarding/gender");
    await page.getByRole("button", { name: "A man" }).click();
    await answerSevenQuestions(page);
    await driveMatchingThroughChat(page, { reducedMotion: true });

    await expect(page).toHaveURL(/\/chat\/c_/);
    await page.getByRole("button", { name: "Back" }).click();
    await page.waitForURL("**/home");
    const cards = page.locator('[class*="carousel"]:not([class*="carouselWrap"]) > div');
    await expect(cards).toHaveCount(3);

    assertHealthy(health);
  });
});
