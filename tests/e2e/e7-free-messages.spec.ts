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
  serverSnapshot,
} from "./helpers";

test.describe("E7 trial chats run out, then the plans screen", () => {
  test("E7: 99 seeded sends -> 1-left bar -> send -> out-of-chats bar -> plans screen (chats)", async ({ page }) => {
    const companion = makeCompanion({ id: "c_e7", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 500000 });
    const state = makeState({ companions: [companion], ledger: { freeUsed: 99 } });

    await setClock(page, FIXED_NOW);
    const userId = await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/chat/c_e7");
    await page.waitForURL("**/chat/c_e7");

    // 100 - 99 = 1 chat left -> the 1-left bar, with the plans link
    await expect(page.getByText("1 free message left today")).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose a plan" })).toBeVisible();
    await screenshotScreen(page, "e7-01-one-left-bar");
    await assertMinFontSize(page);

    // send the last chat of the day
    await page.getByLabel("Message").fill("Hello there");
    await page.getByRole("button", { name: "Send" }).click();

    // 0 left -> the composer is replaced by the plans bar
    const bar = page.getByTestId("composer-trialLimit");
    await expect(bar).toHaveText("Out of chats for today. Choose a plan to keep going.");
    await expect(page.getByLabel("Message")).toHaveCount(0);
    await screenshotScreen(page, "e7-02-out-of-chats-bar");

    // tapping it opens the plans screen from the chats entry point, on Pro
    await bar.click();
    await page.waitForURL("**/plans?from=chats");
    await expect(page.getByTestId("plans-head")).toHaveText("You are out of chats for today.");
    await expect(page.getByTestId("tier-pro")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("plans-meter")).toContainText("0 of 100 trial chats left today");
    await screenshotScreen(page, "e7-03-plans-chats");

    // every step went through the server: the last chat is recorded and no plan was granted
    const snap = await serverSnapshot(userId);
    expect(snap.ledger).toMatchObject({ free_used: 100 });
    expect(snap.subscription).toBeNull();
    expect(snap.messages.filter((m) => m.who === "me").map((m) => m.text)).toEqual(["Hello there"]);

    assertHealthy(health);
  });
});
