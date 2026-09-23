import { test, expect } from "@playwright/test";
import { screenshotScreen, uniqueEmail, createUser, loginWithPassword } from "./helpers";

test.describe("E20 log out everywhere", () => {
  test("E20: 'Log out everywhere' on one device bounces the other to the splash on its next navigation", async ({ browser }) => {
    const email = uniqueEmail();
    const password = "shared password 123";
    await createUser(email, password);

    const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await loginWithPassword(pageA, email, password);
    await pageA.waitForURL("**/home", { timeout: 15000 });
    await loginWithPassword(pageB, email, password);
    await pageB.waitForURL("**/home", { timeout: 15000 });

    await pageA.goto("/settings/account");
    await pageA.getByRole("button", { name: "Log out everywhere" }).click();
    await expect(pageA.getByText("This logs you out on every device, including this one.")).toBeVisible();
    await screenshotScreen(pageA, "e20-01-logout-everywhere-confirm");
    await pageA.getByRole("button", { name: "Log out everywhere" }).last().click();
    await pageA.waitForURL((u) => u.pathname === "/", { timeout: 15000 });

    // Device B, still holding its old token, is bounced on the next navigation.
    await pageB.goto("/home");
    await pageB.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
    await expect(pageB.getByText("Get started")).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });
});
