import { test, expect } from "@playwright/test";
import { trackHealth, assertHealthy, assertMinFontSize, screenshotScreen, uniqueEmail, createUser, fillCode } from "./helpers";
import { waitForCode, hasMail } from "./mail";

test.describe("E17 login with an email code", () => {
  test("E17: a returning user logs in with a code and lands on home", async ({ page }) => {
    const email = uniqueEmail();
    await createUser(email);
    const health = trackHealth(page);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await screenshotScreen(page, "e17-01-login");
    await assertMinFontSize(page);
    await page.getByRole("button", { name: "Send code" }).click();

    await expect(page.getByText(`If an account exists for ${email}, we've sent a code.`)).toBeVisible();
    await screenshotScreen(page, "e17-02-login-code");
    await fillCode(page, await waitForCode(email));

    await page.waitForURL("**/home", { timeout: 15000 });
    assertHealthy(health);
  });

  test("E17: an unknown email shows the identical generic message and sends no mail", async ({ page }) => {
    const known = uniqueEmail();
    await createUser(known);
    const unknown = uniqueEmail();

    await page.goto("/login");
    await page.getByLabel("Email").fill(unknown);
    await page.getByRole("button", { name: "Send code" }).click();
    const generic = page.getByText(`If an account exists for ${unknown}, we've sent a code.`);
    await expect(generic).toBeVisible();

    // Same wording as for a real account, apart from the address.
    const unknownText = ((await generic.textContent()) ?? "").replace(unknown, "{email}");

    const second = await page.context().newPage();
    await second.goto("/login");
    await second.getByLabel("Email").fill(known);
    await second.getByRole("button", { name: "Send code" }).click();
    const knownLine = second.getByText(`If an account exists for ${known}, we've sent a code.`);
    await expect(knownLine).toBeVisible();
    expect(((await knownLine.textContent()) ?? "").replace(known, "{email}")).toBe(unknownText);

    // The real account got its mail; the unknown address got none.
    await waitForCode(known);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await hasMail(unknown)).toBe(false);
  });
});
