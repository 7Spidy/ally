import { test, expect } from "@playwright/test";
import { trackHealth, screenshotScreen, uniqueEmail, createUser, adminClient, fillCode, loginWithPassword } from "./helpers";
import { waitForCode } from "./mail";

test.describe("E18 password login", () => {
  test("E18: set a password in Settings, log out, log in with it; a wrong password shows the generic error", async ({ page }) => {
    const email = uniqueEmail();
    const password = "correct horse battery";
    const userId = await createUser(email);
    const health = trackHealth(page);

    // Log in once with a code (the only OTP this user is sent).
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    await fillCode(page, await waitForCode(email));
    await page.waitForURL("**/home", { timeout: 15000 });

    await page.goto("/settings/account");
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole("button", { name: "Set password" }).click();
    await page.getByLabel("New password").fill(password);
    await screenshotScreen(page, "e18-01-set-password");
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();

    const { data } = await adminClient().auth.admin.getUserById(userId);
    expect(data.user?.user_metadata?.has_password).toBe(true);

    // Log out returns to the first-run splash.
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/");
    await expect(page.getByText("Get started")).toBeVisible();

    await loginWithPassword(page, email, password);
    await page.waitForURL("**/home", { timeout: 15000 });

    // Wrong password.
    await page.goto("/settings/account");
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/");
    await loginWithPassword(page, email, "not the password");
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    await screenshotScreen(page, "e18-02-bad-login");
    await expect(page).toHaveURL(/\/login/);

    // The wrong-password attempt is answered 400 by the auth API, which the browser logs; nothing else may error.
    expect(health.errors.filter((e) => !e.includes("400"))).toEqual([]);
    expect(health.failed).toEqual([]);
  });
});
