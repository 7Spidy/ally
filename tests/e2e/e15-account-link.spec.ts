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
  stateKeyFor,
  uniqueEmail,
  adminClient,
  fillCode,
} from "./helpers";
import { waitForCode } from "./mail";

test.describe("E15 link an email to the anonymous user", () => {
  test("E15: first exchange -> sheet -> email + code from mail -> skip password; settings shows the email; same UID", async ({ page }) => {
    const companion = makeCompanion({ id: "c_e15", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 500000 });
    const state = makeState({
      companions: [companion],
      user: { accountAt: null, accountContact: null, accountKind: null },
    });
    const email = uniqueEmail();

    await setClock(page, FIXED_NOW);
    const userId = await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/chat/c_e15");
    await page.getByLabel("Message").fill("Hello there");
    await page.getByRole("button", { name: "Send" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Email")).toBeVisible({ timeout: 10000 });
    await screenshotScreen(page, "e15-01-account-sheet-email");
    await assertMinFontSize(page);

    await dialog.getByLabel("Email").fill(email);
    await dialog.getByRole("button", { name: "Send code" }).click();

    await expect(dialog.getByText(`We've sent a 6-digit code to ${email}`)).toBeVisible();
    await screenshotScreen(page, "e15-02-account-sheet-code");
    await fillCode(page, await waitForCode(email));

    await expect(dialog.getByText("You can always log in with a code instead.")).toBeVisible();
    await screenshotScreen(page, "e15-03-account-sheet-password");
    await dialog.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Same user id, now a permanent user with the verified email.
    const { data } = await adminClient().auth.admin.getUserById(userId);
    expect(data.user?.id).toBe(userId);
    expect(data.user?.email).toBe(email);
    expect(data.user?.is_anonymous).toBe(false);

    // Local state stayed under the same per-user key and recorded the account.
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), stateKeyFor(userId));
    expect(JSON.parse(stored as string).user.accountContact).toBe(email);

    await page.goto("/settings");
    await expect(page.getByText(email)).toBeVisible();
    await screenshotScreen(page, "e15-04-settings-with-email");

    assertHealthy(health);
  });
});
