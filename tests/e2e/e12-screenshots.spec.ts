import { test, expect } from "@playwright/test";
import {
  FIXED_NOW,
  setClock,
  seedState,
  makeState,
  makeCompanion,
  screenshotScreen,
} from "./helpers";

/**
 * E12: screenshot every new screen at 390x844 into tests/e2e/__screens__/.
 * Onboarding, home, chat and hub-sheet screens are already captured inline
 * by E1/E3/E4/E5/E7/E8/E9/E10. This file rounds out the remaining screens:
 * settings + its subpages, profile, the leave sheet, and the blocked gate.
 */
test.describe("E12 screenshots of remaining screens", () => {
  test("settings, notifications, privacy, how, profile, leave sheet", async ({ page }) => {
    const companion = makeCompanion({ id: "c_e12", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 500000 });
    // slotsUnlocked=2 so the intro sheet's Start routes straight to
    // /onboarding/gender (skipping the unlock sheet, already covered by E3/E4).
    const state = makeState({ companions: [companion], ledger: { slotsUnlocked: 2 } });
    await setClock(page, FIXED_NOW);
    await seedState(page, state);

    await page.goto("/settings");
    await page.waitForURL("**/settings");
    await screenshotScreen(page, "e12-01-settings");

    await page.goto("/settings/notifications");
    await screenshotScreen(page, "e12-02-settings-notifications");

    await page.goto("/settings/privacy");
    await expect(page.getByText("Download my data")).toBeVisible();
    await screenshotScreen(page, "e12-03-settings-privacy");

    await page.getByRole("button", { name: "Delete everything" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await screenshotScreen(page, "e12-04-delete-sheet");
    await page.keyboard.press("Escape");

    await page.goto("/profile/c_e12");
    await page.waitForURL("**/profile/c_e12");
    await screenshotScreen(page, "e12-05-profile");

    // leave sheet: reach it from round-two onboarding's X control
    await page.goto("/home");
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start" }).click();
    await page.waitForURL("**/onboarding/gender");
    await page.getByRole("button", { name: "Leave" }).click();
    await expect(page.getByRole("dialog").getByText("Leave?")).toBeVisible();
    await screenshotScreen(page, "e12-06-leave-sheet");
  });

  test("blocked gate screen", async ({ page }) => {
    await setClock(page, FIXED_NOW);
    await page.goto("/");
    await page.getByRole("button", { name: "Get started" }).click();
    await page.waitForURL("**/onboarding/consent");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Mumbai", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "A woman" }).click();
    await page.waitForURL("**/onboarding/name");
    await page.getByLabel("What should I call you?").fill("Under Age");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/onboarding/birthday");
    // pick a year that makes the user under 18 relative to FIXED_NOW (2026)
    await page.getByLabel("Year").selectOption("2015");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/blocked");
    await expect(page.getByText("Ally is for adults.")).toBeVisible();
    await screenshotScreen(page, "e12-07-blocked");
  });
});
