import { test, expect } from "@playwright/test";
import {
  FIXED_NOW,
  setClock,
  seedState,
  makeState,
  makeCompanion,
  trackHealth,
  screenshotScreen,
  uniqueEmail,
  createUser,
} from "./helpers";

test.describe("E16 email collision while linking", () => {
  test("E16: an email that already has an account offers 'Log in', which lands on /login prefilled", async ({ page }) => {
    const takenEmail = uniqueEmail();
    await createUser(takenEmail);

    const companion = makeCompanion({ id: "c_e16", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 500000 });
    const state = makeState({
      companions: [companion],
      user: { accountAt: null, accountContact: null, accountKind: null },
    });

    await setClock(page, FIXED_NOW);
    await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/chat/c_e16");
    await page.getByLabel("Message").fill("Hello there");
    await page.getByRole("button", { name: "Send" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Email").fill(takenEmail);
    await dialog.getByRole("button", { name: "Send code" }).click();

    await expect(dialog.getByText("This email already has an account.")).toBeVisible();
    await screenshotScreen(page, "e16-01-collision");

    // "Use another email" goes back to a blank email step.
    await dialog.getByRole("button", { name: "Use another email" }).click();
    await expect(dialog.getByLabel("Email")).toHaveValue("");
    await dialog.getByLabel("Email").fill(takenEmail);
    await dialog.getByRole("button", { name: "Send code" }).click();
    await expect(dialog.getByText("This email already has an account.")).toBeVisible();

    await dialog.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/login\?email=.*discard=1/);

    // Logging in over an anonymous session with set-up data asks first.
    await expect(page.getByText("Logging in will discard what you've set up on this device. Continue?")).toBeVisible();
    await screenshotScreen(page, "e16-02-login-discard-confirm");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByLabel("Email")).toHaveValue(takenEmail);
    await screenshotScreen(page, "e16-03-login-prefilled");

    // Each collision is answered 422 email_exists by the auth API, which the browser logs; nothing else may error.
    expect(health.errors.filter((e) => !e.includes("422"))).toEqual([]);
    expect(health.failed).toEqual([]);
  });
});
