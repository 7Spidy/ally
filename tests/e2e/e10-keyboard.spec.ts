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
  tabUntil,
} from "./helpers";

test.describe("E10 keyboard-only navigation", () => {
  test("E10: splash -> home -> a chat -> settings -> How Ally works -> back to home, keyboard only", async ({
    page,
  }) => {
    const companion = makeCompanion({ id: "c_e10", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 500000 });
    // 0 active companions + accountAt set -> returning splash boots to /home
    // automatically (no click needed), which is the "splash" leg of this test.
    const state = makeState({ companions: [{ ...companion, status: "parted", partedAt: FIXED_NOW - 1000, purgeAt: FIXED_NOW + 29 * 86400000 }], ledger: { parted: ["F01"] } });

    await setClock(page, FIXED_NOW);
    await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/");
    await page.waitForURL("**/home", { timeout: 5000 }); // automatic, no interaction
    await screenshotScreen(page, "e10-01-home-via-splash");

    // Re-seed with an active companion for the rest of the keyboard journey
    // (home -> a chat -> settings -> how -> home), reached purely via
    // Tab/Enter from here on.
    await seedState(
      page,
      makeState({
        companions: [makeCompanion({ id: "c_e10b", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 400000 })],
      })
    );
    await page.goto("/home");
    await page.waitForURL("**/home");

    // Tab to the companion card and press Enter to open its chat.
    await tabUntil(page, (el) => el.tag === "BUTTON" && el.text.includes("Ira"));
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/chat\/c_e10b/);
    await screenshotScreen(page, "e10-02-chat-via-keyboard");

    // Back to home, then Tab to the settings (monogram) button.
    await tabUntil(page, (el) => el.tag === "BUTTON" && el.aria === "Back");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/home");

    await tabUntil(page, (el) => el.tag === "BUTTON" && el.aria === "Settings");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/settings");
    await screenshotScreen(page, "e10-03-settings-via-keyboard");

    // Tab to "How Ally works".
    await tabUntil(page, (el) => el.text.includes("How Ally works"));
    await page.keyboard.press("Enter");
    await page.waitForURL("**/settings/how");
    await screenshotScreen(page, "e10-04-how-via-keyboard");

    // Back to settings, then back to home.
    await tabUntil(page, (el) => el.tag === "BUTTON" && el.aria === "Back");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/settings");
    await tabUntil(page, (el) => el.tag === "BUTTON" && el.aria === "Back");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/home");
    await screenshotScreen(page, "e10-05-home-final");

    assertHealthy(health);
  });
});
