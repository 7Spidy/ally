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
} from "./helpers";

test.describe("E7 free message ledger exhaustion + paywall + pass purchase", () => {
  test("E7: 99 seeded sends -> 1-left bar -> send -> out-of-messages bar -> paywall -> pass re-enables sending", async ({
    page,
  }) => {
    const companion = makeCompanion({ id: "c_e7", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 500000 });
    const state = makeState({ companions: [companion], ledger: { freeUsed: 99 } });

    await setClock(page, FIXED_NOW);
    await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/chat/c_e7");
    await page.waitForURL("**/chat/c_e7");

    // n = 100 - 99 = 1 -> 1-left bar
    await expect(page.getByText("1 free message left today")).toBeVisible();
    await screenshotScreen(page, "e7-01-one-left-bar");
    await assertMinFontSize(page);

    // send the last free message
    await page.getByLabel("Message").fill("Hello there");
    await page.getByRole("button", { name: "Send" }).click();

    // n = 0 -> out-of-messages bar
    await expect(page.getByText("You're out of free messages for today")).toBeVisible();
    await screenshotScreen(page, "e7-02-out-of-messages-bar");

    // composer tap opens the paywall
    await page.getByLabel("Message").click();
    const paywallDialog = page.getByRole("dialog");
    await expect(paywallDialog.getByText("Out of messages for today")).toBeVisible();
    await screenshotScreen(page, "e7-03-paywall-sheet");

    // buying a pass re-enables sending
    await paywallDialog.getByRole("button", { name: "Get a day pass" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("Message")).toBeEditable();
    await page.getByLabel("Message").fill("Back in business");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Back in business")).toBeVisible();
    await screenshotScreen(page, "e7-04-sending-with-pass");

    assertHealthy(health);
  });
});
