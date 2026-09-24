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

test.describe("E7 free message ledger exhaustion + paywall + pass purchase", () => {
  test("E7: 99 seeded sends -> 1-left bar -> send -> out-of-messages bar -> paywall -> pass re-enables sending", async ({
    page,
  }) => {
    const companion = makeCompanion({ id: "c_e7", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 500000 });
    const state = makeState({ companions: [companion], ledger: { freeUsed: 99 } });

    await setClock(page, FIXED_NOW);
    const userId = await seedState(page, state);
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

    // P2: every step above went through the server. The seed was written only
    // to the server tables, the last free send and the pass purchase are
    // recorded there, and the post-pass send was debited from the pass.
    const snap = await serverSnapshot(userId);
    expect(snap.ledger).toMatchObject({ free_used: 100, pass_used: 1 });
    expect(Date.parse(snap.ledger!.pass_ends_at as string)).toBeGreaterThan(Date.now());
    expect(snap.passes).toHaveLength(1);
    expect(snap.passes[0]).toMatchObject({ amount: 49 });
    expect(snap.messages.filter((m) => m.who === "me").map((m) => m.text)).toEqual(["Hello there", "Back in business"]);

    assertHealthy(health);
  });
});
