import { test, expect, type Page } from "@playwright/test";
import {
  FIXED_NOW,
  STATE_KEY,
  setClock,
  seedState,
  makeState,
  makeCompanion,
  emptyAnswers,
  defaultCore,
  trackHealth,
  assertHealthy,
  assertMinFontSize,
  screenshotScreen,
} from "./helpers";

// First-run visuals spec §6: the Ripple splash and the Rivers gender choice.

const WOMEN = Array.from({ length: 16 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`);

/** Splash -> consent -> location -> gender, the first-run path (no helper stops here). */
async function toGender(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.waitForURL("**/onboarding/consent");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Mumbai", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("**/onboarding/gender");
  await expect(page.getByRole("button", { name: "A woman" })).toBeVisible();
}

/** flow.deckGender from whichever namespaced state key this context wrote. */
async function deckGender(page: Page) {
  return page.evaluate((prefix) => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      try {
        const s = JSON.parse(localStorage.getItem(k) as string);
        if (s?.flow) return s.flow.deckGender as string | null;
      } catch {
        /* not ours */
      }
    }
    return undefined;
  }, `${STATE_KEY}:`);
}

/** Mouse drag from the arena's centre by `frac` of its height (positive = down). */
async function dragArena(page: Page, frac: number) {
  const box = await page.locator('[class*="arena"]').boundingBox();
  if (!box) throw new Error("arena not found");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y + (box.height * frac * i) / steps);
    await page.waitForTimeout(16);
  }
  // Hold still so the release is judged on position, not a velocity flick.
  await page.waitForTimeout(250);
  await page.mouse.up();
}

test.describe("E26 first-run visuals", () => {
  test("E26.1: splash renders the ripple or its fallback; a photo tap stays put; Get started reaches consent", async ({ page }) => {
    await setClock(page, FIXED_NOW);
    const health = trackHealth(page);

    await page.goto("/");
    const getStarted = page.getByRole("button", { name: "Get started" });
    await expect(getStarted).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Someone to talk to. Not a chatbot pretending.");
    await expect(page.locator("canvas, [aria-hidden='true'] img[class*='on']").first()).toBeVisible();
    await page.waitForTimeout(1200);
    await assertMinFontSize(page);
    await screenshotScreen(page, "e26-01-splash");

    await page.mouse.click(195, 300);
    await page.waitForTimeout(600);
    expect(new URL(page.url()).pathname).toBe("/");

    await getStarted.click();
    await page.waitForURL("**/onboarding/consent");
    assertHealthy(health);
  });

  test("E26.2: tapping the women river lands on name with deckGender woman", async ({ page }) => {
    await setClock(page, FIXED_NOW);
    const health = trackHealth(page);
    await toGender(page);
    await expect(page.getByText("Drag the line, or tap one.")).toBeVisible();
    await page.waitForTimeout(3000); // let the hint wiggle finish
    await assertMinFontSize(page);
    await screenshotScreen(page, "e26-02-rivers");

    await page.getByRole("button", { name: "A woman" }).click();
    await page.waitForURL("**/onboarding/name");
    await expect.poll(() => deckGender(page)).toBe("woman");
    assertHealthy(health);
  });

  test("E26.3: a 45% drag commits (down woman, up man); a 20% drag springs back", async ({ page }) => {
    await setClock(page, FIXED_NOW);
    const health = trackHealth(page);
    await toGender(page);
    await page.waitForTimeout(3000);

    await dragArena(page, 0.2);
    await page.waitForTimeout(1200);
    expect(new URL(page.url()).pathname).toBe("/onboarding/gender");
    await expect(page.getByRole("button", { name: "A woman" })).toHaveAttribute("aria-pressed", "false");

    await dragArena(page, 0.45);
    await page.waitForURL("**/onboarding/name");
    await expect.poll(() => deckGender(page)).toBe("woman");

    // Back to gender: the rivers remount at rest with the previous pick marked.
    await page.getByRole("button", { name: "Back" }).click();
    await page.waitForURL("**/onboarding/gender");
    await expect(page.getByRole("button", { name: "A woman" })).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(3000);

    await dragArena(page, -0.45);
    await page.waitForURL("**/onboarding/name");
    await expect.poll(() => deckGender(page)).toBe("man");
    assertHealthy(health);
  });

  test("E26.4: round two with every woman taken or parted: women river is empty and inert, men still commit", async ({ page }) => {
    // One active woman (F01) plus the other 15 women parted empties the
    // women pool. Two slots unlocked (with the matching unlock record) so
    // round two starts without the unlock sheet; one active companion is
    // within the cap.
    const active = makeCompanion({ id: "c_e26active", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 500000 });
    const state = makeState({
      companions: [active],
      ledger: {
        slotsUnlocked: 2,
        unlocks: [{ slot: 2, at: FIXED_NOW - 400000, amount: 199 }],
        parted: WOMEN.slice(1),
      },
    });
    await setClock(page, FIXED_NOW);
    await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/home");
    await page.waitForURL("**/home");
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start" }).click();
    await page.waitForURL("**/onboarding/gender");

    await expect(page.getByText("No new faces left here")).toBeVisible();
    await expect(page.getByRole("button", { name: "A woman" })).toBeDisabled();
    await expect(page.getByText("Things may have changed since last time")).toBeVisible();
    await page.waitForTimeout(3000);
    await screenshotScreen(page, "e26-03-rivers-women-empty");

    await dragArena(page, 0.45);
    await page.waitForTimeout(1200);
    expect(new URL(page.url()).pathname).toBe("/onboarding/gender");

    await page.getByRole("button", { name: "A man" }).click();
    await page.waitForURL("**/onboarding/questions/disclosure");
    assertHealthy(health);
  });

  test("E26.5: reduced motion: no canvas on the splash, and the gender tap commits", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setClock(page, FIXED_NOW);
    const health = trackHealth(page);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.locator("canvas")).toHaveCount(0);

    await toGender(page);
    await page.getByRole("button", { name: "A man" }).click();
    await page.waitForURL("**/onboarding/name");
    await expect.poll(() => deckGender(page)).toBe("man");
    assertHealthy(health);
  });

  test("E26.6: changing gender after the deck was built still invalidates and shows the recompute toast", async ({ page }) => {
    // First-run flow parked on gender with a built deck for "woman".
    const flow = {
      kind: "first",
      step: "gender",
      cityRaw: "Mumbai",
      region: "West",
      deckGender: "woman",
      displayName: "Riya",
      dob: "2002-01-01",
      age: 24,
      answers: { ...emptyAnswers(), q5: 1, q6: 50, q7: 50, q8: 1, q9: 50, q10: 50, q11: ["making", "screen"] },
      core: defaultCore(),
      deckOrder: ["F01", "F02", "F03"],
      deckIndex: 1,
      deckHistory: [],
      dwell: {},
      liked: ["F01"],
      expanded: [],
      poolRemoved: [],
      redraws: 0,
      canRedraw: false,
      proposed: null,
      proposalsSeen: 0,
      proposalMode: null,
    };
    const state = makeState({ flow, user: { accountAt: null, accountContact: null, accountKind: null } });
    await setClock(page, FIXED_NOW);
    await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/onboarding/gender");
    await expect(page.getByRole("button", { name: "A woman" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "A man" }).click();
    await expect(page.getByText("That changed who you'd meet. Starting the deck again.")).toBeVisible();
    await page.waitForURL("**/onboarding/name");
    await expect.poll(() => deckGender(page)).toBe("man");
    assertHealthy(health);
  });
});
