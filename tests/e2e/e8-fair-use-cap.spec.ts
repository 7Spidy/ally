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
import { HIDDEN_DAILY_CAPS } from "@/lib/config";

test.describe("E8 paid plan hits the hidden fair-use cap", () => {
  test("E8: Pro at the cap minus one, send 1 -> neutral fair-use notice replaces the composer, no counter, no upsell", async ({ page }) => {
    const companion = makeCompanion({ id: "c_e8", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 500000 });
    const state = makeState({ companions: [companion], plan: "pro", ledger: { freeUsed: HIDDEN_DAILY_CAPS.pro - 1 } });

    await setClock(page, FIXED_NOW);
    const userId = await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/chat/c_e8");
    await page.waitForURL("**/chat/c_e8");

    // a paid plan shows no counter, even one send from the cap
    await expect(page.getByText(/left today/)).toHaveCount(0);
    await expect(page.getByText("1 free message left today")).toHaveCount(0);

    await page.getByLabel("Message").fill("One more before the cap");
    await page.getByRole("button", { name: "Send" }).click();

    // the next send is refused server-side; the composer becomes the notice
    await expect(page.getByLabel("Message")).toBeEditable();
    await page.getByLabel("Message").fill("And one more");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("You have reached today's fair-use limit. It resets at midnight.")).toBeVisible();
    await expect(page.getByLabel("Message")).toHaveCount(0);
    // neutral: no plans link, no counter
    await expect(page.getByRole("button", { name: /choose a plan/i })).toHaveCount(0);
    await expect(page.getByText(String(HIDDEN_DAILY_CAPS.pro))).toHaveCount(0);
    await screenshotScreen(page, "e8-01-fair-use-notice");
    await assertMinFontSize(page);

    // the cap was reached server-side
    const snap = await serverSnapshot(userId);
    expect(snap.ledger).toMatchObject({ free_used: HIDDEN_DAILY_CAPS.pro });
    expect(snap.messages.filter((m) => m.who === "me").map((m) => m.text)).toEqual(["One more before the cap"]);

    assertHealthy(health);
  });
});
