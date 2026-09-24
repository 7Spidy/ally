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

test.describe("E8 pass cap -> done for the night", () => {
  test("E8: pass at 1999 used, send 1 -> done-for-the-night bar replaces the composer", async ({ page }) => {
    const companion = makeCompanion({ id: "c_e8", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 500000 });
    const state = makeState({
      companions: [companion],
      ledger: {
        pass: { startedAt: FIXED_NOW - 3600000, endsAt: FIXED_NOW + 20 * 3600000, used: 1999 },
      },
    });

    await setClock(page, FIXED_NOW);
    const userId = await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/chat/c_e8");
    await page.waitForURL("**/chat/c_e8");

    await page.getByLabel("Message").fill("One more before the cap");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("done for the night. Back tomorrow.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Message")).toHaveCount(0);
    await screenshotScreen(page, "e8-01-done-for-the-night");
    await assertMinFontSize(page);

    // P2: the cap was reached server-side (send_message debited the pass).
    const snap = await serverSnapshot(userId);
    expect(snap.ledger).toMatchObject({ pass_used: 2000 });
    expect(snap.messages.filter((m) => m.who === "me").map((m) => m.text)).toEqual(["One more before the cap"]);

    assertHealthy(health);
  });
});
