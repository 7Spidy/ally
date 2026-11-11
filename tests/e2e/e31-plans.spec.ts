import { test, expect, type Page } from "@playwright/test";
import {
  FIXED_NOW,
  adminClient,
  assertHealthy,
  assertMinFontSize,
  makeCompanion,
  makeState,
  screenshotScreen,
  seedPlan,
  seedState,
  serverSnapshot,
  setClock,
  trackHealth,
} from "./helpers";
import { PLAY_SUBSCRIPTIONS_URL } from "@/lib/config";

// E31: the plan picker and every way into it (spec 4.4 and 4.5), against the local Supabase stack.

const url = (from: string) => new RegExp(`/plans\\?from=${from}$`);
const comp = (id: string, templateId: string, gender: "woman" | "man", ago: number, extra: Partial<Parameters<typeof makeCompanion>[0]> = {}) =>
  makeCompanion({ id, templateId, deckGender: gender, createdAt: FIXED_NOW - ago, ...extra });

async function open(page: Page, state: ReturnType<typeof makeState>) {
  await setClock(page, FIXED_NOW);
  const userId = await seedState(page, state);
  return { userId, health: trackHealth(page) };
}

test.describe("E31 entry points open the right plans screen", () => {
  test("E31.1: the trial chip goes to from=trial on Pro, with the day meter; Maybe later goes back", async ({ page }) => {
    const state = makeState({ companions: [comp("c_e31a", "F08", "woman", 500000)], plan: { trialDay: 4 } });
    const { health } = await open(page, state);

    await page.goto("/home");
    const chip = page.getByTestId("trial-chip");
    await expect(chip).toHaveText("Free trial, 3 days left");
    await expect(page.getByTestId("chats-chip")).toHaveCount(0); // plenty of chats left
    await chip.click();

    await page.waitForURL(url("trial"));
    await expect(page.getByTestId("plans-head")).toHaveText("3 days left of your free week.");
    await expect(page.getByTestId("plans-meter")).toContainText("Day 4 of 7, free trial");
    await expect(page.getByTestId("tier-pro")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("plans-cta")).toHaveText("Get Ally on Google Play"); // a browser, not the Android app
    await expect(page.getByText("Billed monthly by Google Play. Prices include GST. Cancel any time in the Play Store. Fair use applies to unlimited chats.")).toBeVisible();
    await screenshotScreen(page, "e31-01-plans-trial");
    await assertMinFontSize(page);

    await page.getByTestId("plans-later").click();
    await page.waitForURL("**/home");
    assertHealthy(health);
  });

  test("E31.2: the chats-left chip goes to from=chats on Pro; the 1-left prompt does too", async ({ page }) => {
    const state = makeState({ companions: [comp("c_e31b", "F08", "woman", 500000)], ledger: { freeUsed: 90 } });
    await open(page, state);

    await page.goto("/home");
    await expect(page.getByTestId("trial-chip")).toBeVisible();
    await page.getByTestId("chats-chip").click(); // "10 left today"
    await page.waitForURL(url("chats"));
    await expect(page.getByTestId("plans-head")).toHaveText("You have 10 chats left today.");
    await expect(page.getByTestId("plans-meter")).toContainText("10 of 100 trial chats left today");
    await expect(page.getByTestId("tier-pro")).toHaveAttribute("aria-checked", "true");
  });

  test("E31.3: a trial user with one chat left sees the prompt; its link goes to from=chats", async ({ page }) => {
    const state = makeState({ companions: [comp("c_e31c", "F08", "woman", 500000)], ledger: { freeUsed: 99 } });
    await open(page, state);
    await page.goto("/chat/c_e31c");
    await expect(page.getByText("1 free message left today")).toBeVisible();
    await page.getByRole("button", { name: "Choose a plan" }).click();
    await page.waitForURL(url("chats"));
    await expect(page.getByTestId("plans-head")).toHaveText("You have 1 chat left today.");
  });

  test("E31.4: Settings has a Plan row showing the plan, which opens from=settings", async ({ page }) => {
    const state = makeState({ companions: [comp("c_e31d", "F08", "woman", 500000)], plan: { trialDay: 2 } });
    const { userId } = await open(page, state);

    await page.goto("/settings");
    const row = page.getByTestId("settings-plan");
    await expect(row).toContainText("Free trial, 5 days left");
    await row.click();
    await page.waitForURL(url("settings"));
    await expect(page.getByTestId("plans-head")).toHaveText("Choose your plan.");

    for (const [plan, label] of [["pro", "Pro"], ["ultra", "Ultra"], ["expired", "No active plan"]] as const) {
      await seedPlan(userId, plan);
      await page.goto("/settings");
      await expect(page.getByTestId("settings-plan")).toContainText(label);
    }
  });
});

test.describe("E31 slots and the new-Ally route", () => {
  test("E31.5: at the plan's slot limit the + card goes to from=newally, pre-selecting the next tier; Ultra just gets the part-ways card", async ({ page }) => {
    const pro = makeState({ companions: [comp("c_e31e", "F08", "woman", 500000)], plan: "pro" });
    const { userId } = await open(page, pro);

    await page.goto("/home");
    await page.getByRole("button", { name: "Start" }).click();
    await page.waitForURL(url("newally"));
    await expect(page.getByTestId("plans-head")).toHaveText("Room for another Ally.");
    await expect(page.getByTestId("tier-pro")).toHaveAttribute("data-current", "true");
    await expect(page.getByTestId("tier-max")).toHaveAttribute("aria-checked", "true");
    await screenshotScreen(page, "e31-02-plans-newally");

    // Max with both slots full: Ultra is the next step
    await serverSeedSecond(userId);
    await seedPlan(userId, "max");
    await page.goto("/home");
    await page.getByRole("button", { name: "Start" }).click();
    await page.waitForURL(url("newally"));
    await expect(page.getByTestId("tier-ultra")).toHaveAttribute("aria-checked", "true");
  });

  test("E31.6: a trial user on one slot gets Max pre-selected from the + card", async ({ page }) => {
    await open(page, makeState({ companions: [comp("c_e31f", "F08", "woman", 500000)] }));
    await page.goto("/home");
    await page.getByRole("button", { name: "Start" }).click();
    await page.waitForURL(url("newally"));
    await expect(page.getByTestId("tier-max")).toHaveAttribute("aria-checked", "true");
  });

  test("E31.7: Ultra with all four slots full never sees the plans screen from +: the cap card asks them to part ways", async ({ page }) => {
    const cs = [comp("c_e31g1", "F01", "woman", 900000), comp("c_e31g2", "F02", "woman", 800000), comp("c_e31g3", "M01", "man", 700000), comp("c_e31g4", "M02", "man", 600000)];
    await open(page, makeState({ companions: cs, plan: "ultra" }));
    await page.goto("/home");
    await expect(page.getByText("That's four")).toBeVisible();
    await expect(page.getByText("Four Allys is the most Ally keeps at once. Part ways with one to make room for someone new.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start" })).toHaveCount(0);
    // opened directly, the screen shows the same message instead of the tiers
    await page.goto("/plans?from=newally");
    await expect(page.getByText("That's four")).toBeVisible();
    await expect(page.getByTestId("tier-pro")).toHaveCount(0);
  });

  test("E31.8: after a downgrade the companions beyond the plan's slots are paused; their composer leads to from=newally", async ({ page }) => {
    const first = comp("c_e31h1", "F08", "woman", 900000, { messages: [{ who: "them", text: "Hey, it's the first one.", at: FIXED_NOW - 890000 }] });
    const second = comp("c_e31h2", "F09", "woman", 800000, { messages: [{ who: "them", text: "Hey, it's the second one.", at: FIXED_NOW - 790000 }] });
    await open(page, makeState({ companions: [first, second], plan: "pro" }));

    // the first by creation stays active
    await page.goto("/chat/c_e31h1");
    await expect(page.getByLabel("Message")).toBeEditable();
    // the second is visible with its history readable, but takes no messages
    await page.goto("/chat/c_e31h2");
    await expect(page.getByText("Hey, it's the second one.")).toBeVisible();
    await expect(page.getByLabel("Message")).toHaveCount(0);
    const bar = page.getByTestId("composer-locked");
    await expect(bar).toHaveText("This Ally is paused on your current plan.");
    await screenshotScreen(page, "e31-03-paused-ally");
    await bar.click();
    await page.waitForURL(url("newally"));
  });
});

test.describe("E31 the free week is over", () => {
  test("E31.9: an expired user is sent to from=locked once per session, with no close button; their chats stay readable but read-only", async ({ page }) => {
    const c = comp("c_e31i", "F08", "woman", 500000, { messages: [{ who: "them", text: "Still here when you are.", at: FIXED_NOW - 400000 }] });
    const { userId } = await open(page, makeState({ companions: [c], plan: "expired" }));

    await page.goto("/home");
    await page.waitForURL(url("locked"));
    await expect(page.getByTestId("plans-head")).toHaveText("Your free week is over.");
    await expect(page.getByText("Pick a plan to keep talking to your Ally. Your chats are saved.")).toBeVisible();
    await expect(page.getByTestId("plans-close")).toHaveCount(0);
    await expect(page.getByTestId("plans-later")).toHaveCount(0);
    await expect(page.getByTestId("tier-pro")).toHaveAttribute("aria-checked", "true");
    await screenshotScreen(page, "e31-04-plans-locked");

    // Read your chats -> the companion list, and the session is not bounced back again
    await page.getByTestId("plans-read-chats").click();
    await page.waitForURL("**/home");
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe("/home");

    await page.goto("/chat/c_e31i");
    await expect(page.getByText("Still here when you are.")).toBeVisible();
    await expect(page.getByLabel("Message")).toHaveCount(0);
    const bar = page.getByTestId("composer-expired");
    await expect(bar).toHaveText("Your free week is over. Choose a plan.");
    await bar.click();
    await page.waitForURL(url("locked"));

    // no way to send around it
    const snap = await serverSnapshot(userId);
    expect(snap.messages.filter((m) => m.who === "me")).toHaveLength(0);
  });

  test("E31.10: opening the app at / lands an expired user on the plans screen too", async ({ page }) => {
    await open(page, makeState({ companions: [comp("c_e31j", "F08", "woman", 500000)], plan: { trialDay: 8 } }));
    await page.goto("/");
    await page.waitForURL(url("locked"), { timeout: 15000 });
  });
});

test.describe("E31 subscribed users and the purchase hand-off", () => {
  const BILLING_STUB = () => {
    const w = window as unknown as { __launched: string[][]; AllyBilling: unknown };
    w.__launched = [];
    w.AllyBilling = {
      launch: (productId: string, basePlanId: string) => w.__launched.push([productId, basePlanId]),
      getPrices: () => ({ ally_pro: "₹299.00", ally_max: "₹499.00", ally_ultra: "₹799.00" }),
    };
  };

  test("E31.11: a Max subscriber sees Your plan / Current plan (disabled) and Switch to {Tier} on the others, plus the Manage link", async ({ page }) => {
    await page.addInitScript(BILLING_STUB);
    await open(page, makeState({ companions: [comp("c_e31k", "F08", "woman", 500000)], plan: "max" }));
    await page.goto("/plans?from=settings");

    await expect(page.getByTestId("plans-head")).toHaveText("Your plan.");
    const max = page.getByTestId("tier-max");
    await expect(max).toHaveAttribute("aria-checked", "true");
    await expect(max).toContainText("Your plan");
    const cta = page.getByTestId("plans-cta");
    await expect(cta).toHaveText("Current plan");
    await expect(cta).toBeDisabled();

    await page.getByTestId("tier-ultra").click();
    await expect(cta).toHaveText("Switch to Ultra");
    await expect(cta).toBeEnabled();
    await page.getByTestId("tier-pro").click();
    await expect(cta).toHaveText("Switch to Pro");

    await expect(page.getByTestId("plans-manage")).toHaveAttribute("href", PLAY_SUBSCRIPTIONS_URL);
    await expect(page.getByTestId("plans-manage")).toHaveText("Manage in Google Play");
    await screenshotScreen(page, "e31-05-plans-subscribed");
  });

  test("E31.12: the tier cards are a keyboard radiogroup", async ({ page }) => {
    await open(page, makeState({ companions: [comp("c_e31l", "F08", "woman", 500000)] }));
    await page.goto("/plans?from=trial");
    const group = page.getByRole("radiogroup", { name: "Choose a plan" });
    await expect(group.getByRole("radio")).toHaveCount(3);
    await page.getByTestId("tier-pro").focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("tier-max")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("tier-max")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("tier-ultra")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("tier-max")).toHaveAttribute("aria-checked", "true");
  });

  test("E31.13: with the Android bridge, the CTA launches Play Billing and the result hook drives the screen", async ({ page }) => {
    await page.addInitScript(BILLING_STUB);
    const { userId, health } = await open(page, makeState({ companions: [comp("c_e31m", "F08", "woman", 500000)], plan: { trialDay: 3 } }));

    await page.goto("/home");
    await page.getByTestId("trial-chip").click();
    await page.waitForURL(url("trial"));
    const cta = page.getByTestId("plans-cta");
    await expect(cta).toHaveText("Continue with Pro, ₹299.00 a month"); // Play's localized price

    await page.getByTestId("tier-ultra").click();
    await expect(cta).toHaveText("Continue with Ultra, ₹799.00 a month");
    await cta.click();
    expect(await page.evaluate(() => (window as unknown as { __launched: string[][] }).__launched)).toEqual([["ally_ultra", "monthly"]]);

    // cancelled: nothing happens
    await page.evaluate(() => (window as unknown as { onAllyPurchaseResult: (r: unknown) => void }).onAllyPurchaseResult({ status: "cancelled" }));
    await expect(page.getByTestId("plans-error")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/plans");

    // error: the inline message under the CTA
    await page.evaluate(() => (window as unknown as { onAllyPurchaseResult: (r: unknown) => void }).onAllyPurchaseResult({ status: "error" }));
    await expect(page.getByTestId("plans-error")).toHaveText("Payment did not go through. Try again.");

    // success: the server (not the client) grants the plan; the screen re-reads it and returns where the user came from
    await seedPlan(userId, "ultra");
    await page.evaluate(() => (window as unknown as { onAllyPurchaseResult: (r: unknown) => void }).onAllyPurchaseResult({ status: "success" }));
    await page.waitForURL("**/home");
    await expect(page.getByTestId("trial-chip")).toHaveCount(0);
    assertHealthy(health);
  });

  test("E31.14: the client cannot grant itself a plan: the hook alone changes nothing on the server", async ({ page }) => {
    await page.addInitScript(BILLING_STUB);
    const { userId } = await open(page, makeState({ companions: [comp("c_e31n", "F08", "woman", 500000)], plan: { trialDay: 3 } }));
    await page.goto("/plans?from=trial");
    await page.evaluate(() => (window as unknown as { onAllyPurchaseResult: (r: unknown) => void }).onAllyPurchaseResult({ status: "success" }));
    await page.waitForURL("**/home").catch(() => {});
    const snap = await serverSnapshot(userId);
    expect(snap.subscription).toBeNull();
    await page.goto("/home");
    await expect(page.getByTestId("trial-chip")).toBeVisible(); // still on the trial
  });
});

test.describe("E31 the deeper level", () => {
  test("E31.15: past level 5 on a lower plan, the chat shows one banner, once; it opens from=deep on Ultra and a row stays on the plans screen", async ({ page }) => {
    const c = comp("c_e31o", "F08", "woman", 500000, { trustLevel: 6 });
    const { userId } = await open(page, makeState({ companions: [c], plan: "pro" }));

    await page.goto("/chat/c_e31o");
    const banner = page.getByTestId("deeper-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("There is a deeper level with ");
    await expect(page.getByText(/\bL6\b/)).toHaveCount(0); // never a raw level number
    await screenshotScreen(page, "e31-06-deeper-banner");
    await banner.getByRole("button").first().click();
    await page.waitForURL(url("deep"));
    await expect(page.getByTestId("plans-head")).toHaveText("There is a deeper level.");
    await expect(page.getByTestId("tier-ultra")).toHaveAttribute("aria-checked", "true");
    // permanently a row on the plans screen
    await expect(page.getByTestId("plans-deeper-row")).toContainText("There is a deeper level with ");

    // shown once: the next open of the same chat has no banner
    await expect.poll(async () => (await serverSnapshot(userId)).companions[0]?.deeper_prompt_shown).toBe(true);
    await page.goto("/chat/c_e31o");
    await expect(page.getByLabel("Message")).toBeEditable();
    await expect(page.getByTestId("deeper-banner")).toHaveCount(0);
    // the stored progress was not touched
    expect((await serverSnapshot(userId)).companions[0]).toMatchObject({ trust_level: 6 });
  });

  test("E31.16: on Ultra there is no deeper-level banner or row", async ({ page }) => {
    const c = comp("c_e31p", "F08", "woman", 500000, { trustLevel: 6 });
    await open(page, makeState({ companions: [c], plan: "ultra" }));
    await page.goto("/chat/c_e31p");
    await expect(page.getByLabel("Message")).toBeEditable();
    await expect(page.getByTestId("deeper-banner")).toHaveCount(0);
    await page.goto("/plans?from=settings");
    await expect(page.getByTestId("plans-deeper-row")).toHaveCount(0);
  });
});

/** Gives the e2e user a second active companion through the service role (the UI path to one is covered by E3). */
async function serverSeedSecond(userId: string) {
  const admin = adminClient();
  const { error } = await admin.from("companions").insert({
    id: "c_e31e2",
    user_id: userId,
    template_id: "F09",
    deck_gender: "woman",
    answers: {},
    core: { primary: "PSYCH", secondary: null, weight: 100, ranked: [] },
    created_at: new Date(Date.now() - 100000).toISOString(),
  });
  if (error) throw new Error(`seed second companion: ${error.message}`);
}
