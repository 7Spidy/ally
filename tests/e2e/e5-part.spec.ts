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
  serverSnapshot,
} from "./helpers";

test.describe("E5 part with one companion", () => {
  test("E5: parting companion 2 removes it from home/switcher/settings; its face never reappears", async ({
    page,
  }) => {
    const c1 = makeCompanion({ id: "c_e5a", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 900000 });
    const c2 = makeCompanion({ id: "c_e5b", templateId: "F02", deckGender: "woman", createdAt: FIXED_NOW - 800000 });
    const state = makeState({
      companions: [c1, c2],
      ledger: { slotsUnlocked: 2, unlocks: [{ slot: 2, at: FIXED_NOW - 850000, amount: 199 }] },
    });

    await setClock(page, FIXED_NOW);
    const userId = await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/profile/c_e5b");
    await page.waitForURL("**/profile/c_e5b");
    await page.getByRole("button", { name: /Part ways with/ }).click();

    const partDialog = page.getByRole("dialog");
    await expect(partDialog.getByText("Part ways with Noor?")).toBeVisible();
    await screenshotScreen(page, "e5-01-part-sheet");
    await partDialog.getByLabel(/Type .* to confirm/).fill("Noor");
    await partDialog.getByRole("button", { name: "Part ways" }).click();

    await page.waitForURL("**/home");
    await screenshotScreen(page, "e5-02-home-after-part");

    // gone from home
    await expect(page.getByText("Noor")).not.toBeVisible();
    const cards = page.locator('[class*="carousel"]:not([class*="carouselWrap"]) > div');
    await expect(cards).toHaveCount(2); // 1 companion card + add card

    // gone from the switcher — navigate in-app (not page.goto, which would
    // re-run the addInitScript seed and clobber the just-persisted part).
    await page.getByText("Ira").click();
    await page.waitForURL("**/chat/c_e5a");
    const avatarBtn = page.locator('[class*="identity"]');
    const box = await avatarBtn.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(650);
      await page.mouse.up();
    }
    const switcherDialog = page.getByRole("dialog");
    await expect(switcherDialog.getByText("Switch to")).toBeVisible({ timeout: 3000 });
    await expect(switcherDialog.getByText("Noor")).not.toBeVisible();
    await switcherDialog.getByText("Home").click();
    await page.waitForURL("**/home");

    // round two needs no unlock (1 active < slotsUnlocked 2) and Noor's face
    // (F02) never reappears in the deck, alongside F01 (still active).
    await page.getByRole("button", { name: "Start" }).click();
    const introDialog = page.getByRole("dialog");
    await introDialog.getByRole("button", { name: "Start" }).click();
    await page.waitForURL("**/onboarding/gender");
    await page.getByRole("button", { name: "A woman" }).click();
    await answerSevenQuestions(page);
    await page.waitForURL("**/onboarding/matching");
    await page.waitForTimeout(2700);
    await page.getByRole("button", { name: "Show me" }).click();
    await page.waitForURL("**/onboarding/deck");
    // pool = 16 woman templates - F01 (still active) - F02 (parted, permanently excluded) = 14
    await expect(page.getByText(/^1 of 14$/)).toBeVisible();
    await screenshotScreen(page, "e5-03-deck-excludes-parted-face");

    // P2: the part went through part_companion; the exclusion the deck just
    // applied comes from the server's ledger_parted.
    const snap = await serverSnapshot(userId);
    expect(snap.companions.find((c) => c.id === "c_e5b")).toMatchObject({ status: "parted" });
    expect(snap.companions.find((c) => c.id === "c_e5a")).toMatchObject({ status: "active" });
    expect(snap.parted).toEqual(["F02"]);

    await assertMinFontSize(page);
    assertHealthy(health);
  });
});
