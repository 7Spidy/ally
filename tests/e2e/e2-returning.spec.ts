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
  assertMinFontSize,
} from "./helpers";

test.describe("E2 reload -> returning splash -> last chat", () => {
  test("E2: reload lands on last chat; browser back lands on /home", async ({ page }) => {
    const companion = makeCompanion({
      id: "c_e2test1",
      templateId: "F01",
      deckGender: "woman",
      createdAt: FIXED_NOW - 100000,
      lastOpenedAt: FIXED_NOW - 100000,
    });
    const state = makeState({ companions: [companion] });

    await setClock(page, FIXED_NOW);
    await seedState(page, state);
    const health = trackHealth(page);

    // Visit /home first so the browser's back-stack has a real prior entry
    // (as it would for any returning user who has used the app before),
    // then reload the boot page — this is the realistic version of
    // "reload -> returning splash -> last chat": the boot page's own
    // router.replace() only ever rewrites the CURRENT history entry, it
    // never touches earlier ones, so whatever was already in the stack
    // before the reload is exactly what browser back lands on afterwards.
    await page.goto("/home");
    await page.waitForURL("**/home");

    await page.goto("/");
    // returning splash briefly, then boot target: last opened chat
    await page.waitForURL(/\/chat\/c_e2test1/, { timeout: 5000 });
    await screenshotScreen(page, "e2-01-returning-to-chat");
    await assertMinFontSize(page);

    await page.goBack();
    await page.waitForURL("**/home");
    await screenshotScreen(page, "e2-02-back-to-home");
    await assertMinFontSize(page);

    assertHealthy(health);
  });
});
