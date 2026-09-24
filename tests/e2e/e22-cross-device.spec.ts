import { test, expect } from "@playwright/test";
import {
  FIXED_NOW,
  setClock,
  trackHealth,
  assertHealthy,
  screenshotScreen,
  driveFirstRunIntro,
  answerSevenQuestions,
  driveMatchingThroughChat,
  serverSnapshot,
  stateKeyFor,
  adminClient,
} from "./helpers";

test.describe("E22 companion survives a new device", () => {
  test("E22: onboarding creates the companion server-side; a fresh context with the same session sees it and its messages", async ({
    page,
    browser,
  }) => {
    await setClock(page, FIXED_NOW);
    const health = trackHealth(page);

    await page.goto("/");
    await page.getByRole("button", { name: "Get started" }).click();
    await page.waitForURL("**/onboarding/consent");
    await driveFirstRunIntro(page, { name: "Riya", city: "Mumbai", gender: "woman" });
    await answerSevenQuestions(page);
    await driveMatchingThroughChat(page);

    const companionId = new URL(page.url()).pathname.split("/chat/")[1];
    // The deck decides who gets proposed; remember whose chat this is.
    const personaName = (await page.locator('[class*="identity"]').innerText()).trim().split(/\s+/)[0];
    await page.getByLabel("Message").fill("Hello from device one");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Hello from device one")).toBeVisible();

    // Server has the companion (with the id the chat route uses), the
    // opener, the sent message and the reply, and the profile name.
    const userId = await page.evaluate(() => Object.keys(window.localStorage).find((k) => k.startsWith("ally_v2:"))!.slice("ally_v2:".length));
    await expect
      .poll(async () => (await serverSnapshot(userId)).messages.map((m) => m.who), { timeout: 10000 })
      .toEqual(["them", "me", "them"]);
    const snap = await serverSnapshot(userId);
    expect(snap.companions).toHaveLength(1);
    expect(snap.companions[0]).toMatchObject({ id: companionId, status: "active", exchanges: 1 });
    expect(snap.ledger).toMatchObject({ free_used: 1 });
    const { data: profile } = await adminClient().from("profiles").select("display_name").eq("id", userId).single();
    expect(profile?.display_name).toBe("Riya");

    // The local blob never holds server-owned data.
    const local = JSON.parse((await page.evaluate((k) => window.localStorage.getItem(k), stateKeyFor(userId))) as string);
    expect(local.companions).toEqual([]);
    expect(local.ledger.freeUsed).toBe(0);

    // "New device": a fresh context carrying only the session cookies, no localStorage.
    const device2 = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await device2.addCookies(await page.context().cookies());
    const page2 = await device2.newPage();
    await setClock(page2, FIXED_NOW);
    const health2 = trackHealth(page2);

    await page2.goto("/");
    await page2.waitForURL(`**/chat/${companionId}`, { timeout: 10000 });
    await expect(page2.getByText("Hello from device one")).toBeVisible();
    expect((await page2.locator('[class*="identity"]').innerText()).trim().split(/\s+/)[0]).toBe(personaName);
    // exchanges (1) came from the server, so the first-exchange account nudge
    // opens here too; it's dismissible.
    await expect(page2.getByRole("dialog")).toBeVisible();
    await screenshotScreen(page2, "e22-01-second-device-chat");
    await page2.keyboard.press("Escape");
    await expect(page2.getByRole("dialog")).toHaveCount(0);

    await page2.getByRole("button", { name: "Back" }).click();
    await page2.waitForURL("**/home");
    const cards = page2.locator('[class*="carousel"]:not([class*="carouselWrap"]) > div');
    await expect(cards).toHaveCount(2); // the companion + the add card
    // The display name came from profiles (monogram), not local storage.
    await expect(page2.getByRole("button", { name: "Settings" })).toHaveText("R");
    await screenshotScreen(page2, "e22-02-second-device-home");

    await device2.close();
    assertHealthy(health);
    assertHealthy(health2);
  });
});
