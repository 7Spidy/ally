import { test, expect } from "@playwright/test";
import { FIXED_NOW, setClock, seedState, makeState, makeCompanion, screenshotScreen, assertMinFontSize } from "./helpers";

test.describe("E25 server unreachable on boot", () => {
  test("E25: a failed get_my_state shows the network message instead of a blank screen, and the retry recovers", async ({ page }) => {
    const companion = makeCompanion({ id: "c_e25", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 500000 });
    await setClock(page, FIXED_NOW);
    await seedState(page, makeState({ companions: [companion] }));

    // Only the server-state load fails; auth and the page itself still load.
    let blocked = 0;
    await page.route("**/rest/v1/rpc/get_my_state", (route) => {
      blocked++;
      return route.abort("internetdisconnected");
    });

    await page.goto("/home");
    const alert = page.getByRole("alert").filter({ hasText: "Couldn't reach Ally. Check your connection and try again." });
    await expect(alert).toBeVisible();
    await expect(page.getByText("Ira")).toHaveCount(0);
    await screenshotScreen(page, "e25-01-network-message");
    await assertMinFontSize(page);

    // Still failing on the next retry: the message stays up.
    await expect.poll(() => blocked, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
    await expect(alert).toBeVisible();

    // Connection back: the next retry lands and the screen replaces the message.
    await page.unroute("**/rest/v1/rpc/get_my_state");
    await expect(page.getByText("Ira")).toBeVisible({ timeout: 10000 });
    await expect(alert).toHaveCount(0);
    await screenshotScreen(page, "e25-02-recovered-home");
  });
});
