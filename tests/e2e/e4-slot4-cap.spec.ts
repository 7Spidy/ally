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
  assertMinFontSize,
  serverSnapshot,
  acceptLiveConsent,
} from "./helpers";

test.describe("E4 fourth companion fills Ultra, then home shows the cap card", () => {
  test("E4: Ultra user adds the fourth Ally -> cap card says part ways to make room", async ({ page }) => {
    const c1 = makeCompanion({ id: "c_e4a", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 900000 });
    const c2 = makeCompanion({ id: "c_e4b", templateId: "M01", deckGender: "man", createdAt: FIXED_NOW - 800000 });
    const c3 = makeCompanion({ id: "c_e4c", templateId: "M02", deckGender: "man", createdAt: FIXED_NOW - 700000 });
    const state = makeState({ companions: [c1, c2, c3], plan: "ultra" });

    await setClock(page, FIXED_NOW);
    const userId = await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/home");
    await page.waitForURL("**/home");

    await page.getByRole("button", { name: "Start" }).click();
    const introDialog = page.getByRole("dialog");
    await introDialog.getByRole("button", { name: "Start" }).click();

    // Ultra has a fourth slot free: straight on, no plans screen
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

    await acceptLiveConsent(page);
    await page.getByRole("button", { name: "Back" }).click();
    await page.waitForURL("**/home");
    await screenshotScreen(page, "e4-02-home-cap-card");

    await expect(page.getByText("That's four")).toBeVisible();
    await expect(page.getByText("Four Allys is the most Ally keeps at once. Part ways with one to make room for someone new.")).toBeVisible();
    await assertMinFontSize(page);

    // The plan came from a subscription row; the fourth companion is a server row.
    const snap = await serverSnapshot(userId);
    expect(snap.subscription).toMatchObject({ plan: "ultra", status: "active" });
    expect(snap.companions.filter((c) => c.status === "active")).toHaveLength(4);

    assertHealthy(health);
  });
});
