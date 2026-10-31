import { test, expect } from "@playwright/test";
import { trackHealth, screenshotScreen, uniqueEmail, createUser, adminClient, fillCode, loginWithPassword } from "./helpers";
import { waitForCode } from "./mail";

/**
 * Both flows delete the user server-side and then call signOut, whose
 * revoke request the API answers with 403 for the now-missing user (the
 * client ignores it, the browser still logs it). That one line is expected;
 * anything else is a real error.
 */
function assertHealthyExceptDeletedUserLogout(h: { errors: string[]; failed: string[] }) {
  expect(h.errors.filter((e) => !e.includes("403"))).toEqual([]);
  expect(h.failed).toEqual([]);
}

test.describe("E21 under-18 purge, route guards and account deletion", () => {
  test("E21a: an under-18 birthday shows a popup, stays on the page, and purges nothing", async ({ page }) => {
    const health = trackHealth(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Continue" }).click();

    // The anonymous user exists once consent is accepted.
    await page.waitForURL("**/onboarding/location");
    const userId = await page.evaluate(() => {
      const key = Object.keys(window.localStorage).find((k) => k.startsWith("ally_v2:"));
      return key ? key.slice("ally_v2:".length) : null;
    });
    expect(userId).toBeTruthy();
    expect((await adminClient().auth.admin.getUserById(userId as string)).data.user?.id).toBe(userId);

    await page.getByRole("button", { name: "Mumbai", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "A woman" }).click();
    await page.waitForURL("**/onboarding/name");
    await page.getByLabel("What should I call you?").fill("Kid");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/onboarding/birthday");

    const thisYear = new Date().getFullYear();
    await page.getByLabel("Year").selectOption(String(thisYear - 10));
    await page.getByRole("button", { name: "Continue" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Ally is for adults.")).toBeVisible();
    await screenshotScreen(page, "e21-01-under18-popup");
    await dialog.getByRole("button", { name: "Check my birthday" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("Year")).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/onboarding/birthday");

    // Nothing was purged or blocked: the anonymous user and its local state are intact.
    expect((await adminClient().auth.admin.getUserById(userId as string)).data.user?.id).toBe(userId);
    expect(await page.evaluate(() => window.localStorage.getItem("ally_blocked_until"))).toBeNull();
    expect(await page.evaluate(() => Object.keys(window.localStorage).some((k) => k.startsWith("ally_v2:")))).toBe(true);

    // Unlimited retries: an adult year goes on.
    await page.getByLabel("Year").selectOption(String(thisYear - 25));
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/onboarding/questions/disclosure");
    assertHealthyExceptDeletedUserLogout(health);
  });

  test("E21b: with no session, /home redirects to /", async ({ page }) => {
    await page.goto("/home");
    await page.waitForURL((u) => u.pathname === "/");
    await expect(page.getByText("Get started")).toBeVisible();
    await screenshotScreen(page, "e21-02-guard-redirect");
  });

  test("E21c: delete account needs DELETE plus a fresh code, then removes the user", async ({ page }) => {
    const email = uniqueEmail();
    const password = "delete me please 1";
    const userId = await createUser(email, password);
    const health = trackHealth(page);

    await loginWithPassword(page, email, password);
    await page.waitForURL("**/home", { timeout: 15000 });
    await page.goto("/settings/account");

    await page.getByRole("button", { name: "Delete account" }).click();
    await expect(page.getByText("Type DELETE to continue.", { exact: false })).toBeVisible();
    const confirm = page.getByRole("button", { name: "Delete account" }).last();
    await expect(confirm).toBeDisabled();
    await page.getByLabel("DELETE", { exact: true }).fill("delete");
    await expect(confirm).toBeDisabled();
    await page.getByLabel("DELETE", { exact: true }).fill("DELETE");
    await screenshotScreen(page, "e21-03-delete-typed");
    await confirm.click();

    await expect(page.getByText(`We've sent a code to ${email} to confirm.`)).toBeVisible();
    await fillCode(page, await waitForCode(email));

    await page.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
    await expect
      .poll(async () => (await adminClient().auth.admin.getUserById(userId)).data.user, { timeout: 10000 })
      .toBeNull();
    assertHealthyExceptDeletedUserLogout(health);
  });
});
