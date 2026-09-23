import { test, expect } from "@playwright/test";
import { trackHealth, assertHealthy, screenshotScreen, uniqueEmail, createUser, fillCode, loginWithPassword } from "./helpers";
import { waitForCode } from "./mail";

test.describe("E19 password reset", () => {
  test("E19: reset by code; the new password works, the old one fails, another device's session is revoked", async ({ browser }) => {
    const email = uniqueEmail();
    const oldPassword = "old password 123";
    const newPassword = "new password 456";
    await createUser(email, oldPassword);

    // Device A is already logged in.
    const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pageA = await ctxA.newPage();
    await loginWithPassword(pageA, email, oldPassword);
    await pageA.waitForURL("**/home", { timeout: 15000 });

    // Device B resets the password.
    const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pageB = await ctxB.newPage();
    const health = trackHealth(pageB);
    await pageB.goto("/login");
    await pageB.getByRole("button", { name: "Forgot password?" }).click();
    await pageB.waitForURL(/\/login\/reset/);
    await pageB.getByLabel("Email").fill(email);
    await pageB.getByRole("button", { name: "Send code" }).click();
    await expect(pageB.getByText(`If an account exists for ${email}, we've sent a code.`)).toBeVisible();
    await screenshotScreen(pageB, "e19-01-reset-code");
    await fillCode(pageB, await waitForCode(email));

    await pageB.getByLabel("New password").fill("short");
    await expect(pageB.getByRole("button", { name: "Update password" })).toBeDisabled();
    await pageB.getByLabel("New password").fill(newPassword);
    await screenshotScreen(pageB, "e19-02-reset-new-password");
    await pageB.getByRole("button", { name: "Update password" }).click();
    await pageB.waitForURL("**/home", { timeout: 15000 });
    assertHealthy(health);

    // The old password no longer works; the new one does.
    const ctxC = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pageC = await ctxC.newPage();
    await loginWithPassword(pageC, email, oldPassword);
    await expect(pageC.getByText("Email or password is incorrect.")).toBeVisible();
    await loginWithPassword(pageC, email, newPassword);
    await pageC.waitForURL("**/home", { timeout: 15000 });

    // Device A's session was revoked: its next navigation bounces to the first-run splash.
    await pageA.goto("/home");
    await pageA.waitForURL((u) => u.pathname === "/", { timeout: 15000 });

    await ctxA.close();
    await ctxB.close();
    await ctxC.close();
  });
});
