import { test, expect, type Page } from "@playwright/test";
import { FIXED_NOW, assertHealthy, grantLiveConsent, makeCompanion, makeState, romanticCore, seedState, setClock, trackHealth } from "./helpers";

// B3: the level badge. One second, by name, every time a live chat opens.

const DAY = 86400000;

async function open(page: Page, o: { id: string; level: number; live?: boolean }) {
  const live = o.live ?? true;
  const companion = makeCompanion({
    id: o.id,
    templateId: "F01",
    deckGender: "woman",
    createdAt: FIXED_NOW - 5 * DAY,
    core: live ? romanticCore() : undefined,
    trustLevel: o.level,
    messages: [{ who: "them", text: "Hey.", at: FIXED_NOW - 4 * DAY }],
  });
  await setClock(page, FIXED_NOW);
  const userId = await seedState(page, makeState({ companions: [companion] }));
  if (live) await grantLiveConsent(userId);
  const health = trackHealth(page);
  await page.goto(`/chat/${o.id}`);
  await page.waitForURL(`**/chat/${o.id}`);
  return { userId, health };
}

test.describe("E29 level badge", () => {
  test.describe.configure({ timeout: 60000 });

  test("E29.1: opening a live chat shows the level name for about a second, then it goes; reopening shows it again", async ({ page }) => {
    const { health } = await open(page, { id: "c_e29_1", level: 1 });
    const badge = page.getByTestId("level-badge");
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("level-badge-name")).toHaveText("Acquaintance");
    // Names the level to a screen reader; shows no "L1" or digit.
    await expect(badge).toContainText("Acquaintance, level 1 of 6");
    await expect(page.getByTestId("level-badge-name")).not.toHaveText(/\d|\bL\d/);
    // Font size is at least 15px.
    const size = await page.getByTestId("level-badge-name").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(15);
    // Gone within 1.5 s.
    await expect(badge).toHaveCount(0, { timeout: 1500 });

    // Away and back: it shows again.
    await page.goto("/home");
    await page.waitForURL("**/home");
    await page.goto("/chat/c_e29_1");
    await expect(page.getByTestId("level-badge-name")).toHaveText("Acquaintance", { timeout: 10000 });
    await expect(page.getByTestId("level-badge")).toHaveCount(0, { timeout: 1500 });
    assertHealthy(health);
  });

  test("E29.2: it names the current level, and a typing user does not retrigger it", async ({ page }) => {
    const { health } = await open(page, { id: "c_e29_2", level: 4 });
    await expect(page.getByTestId("level-badge-name")).toHaveText("Close", { timeout: 10000 });
    await expect(page.getByTestId("level-badge")).toHaveCount(0, { timeout: 1500 });
    await page.getByLabel("Message").fill("a new message that must not bring the badge back");
    await page.getByRole("button", { name: "Send" }).click();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("level-badge")).toHaveCount(0);
    assertHealthy(health);
  });

  test("E29.3: a context card due on open waits until the badge has gone", async ({ page }) => {
    const { health } = await open(page, { id: "c_e29_3", level: 1 });
    await expect(page.getByTestId("level-badge")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("context-card")).toHaveCount(0);
    await expect(page.getByTestId("context-card")).toBeVisible({ timeout: 4000 });
    await expect(page.getByTestId("level-badge")).toHaveCount(0);
    assertHealthy(health);
  });

  test("E29.4: a chat that is not live never shows it", async ({ page }) => {
    const { health } = await open(page, { id: "c_e29_4", level: 1, live: false });
    await page.waitForTimeout(2000);
    await expect(page.getByTestId("level-badge")).toHaveCount(0);
    assertHealthy(health);
  });
});
