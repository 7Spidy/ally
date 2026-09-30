import { test, expect, type Page } from "@playwright/test";
import {
  FIXED_NOW,
  adminClient,
  assertHealthy,
  grantLiveConsent,
  makeCompanion,
  makeState,
  romanticCore,
  screenshotScreen,
  seedState,
  serverSnapshot,
  setClock,
  trackHealth,
} from "./helpers";

// B2: live chat with Ira. The xAI base URL points at /api/test/xai-mock and
// E2E_MOCKS=1 (playwright.config.ts), so replies are the canned LiveOut
// objects keyed by the user's text.

const DAY = 86400000;

interface Opts {
  id: string;
  level?: number;
  messages?: { who: "them" | "me"; text: string; at: number }[];
  live?: boolean;
  createdAt?: number;
  pausedReason?: "age_check" | null;
  consent?: boolean;
}

async function open(page: Page, o: Opts) {
  const live = o.live ?? true;
  const companion = makeCompanion({
    id: o.id,
    templateId: "F01",
    deckGender: "woman",
    createdAt: o.createdAt ?? FIXED_NOW - 5 * DAY,
    core: live ? romanticCore() : undefined,
    trustLevel: o.level ?? 1,
    pausedReason: o.pausedReason ?? null,
    messages: o.messages ?? [{ who: "them", text: "Hey.", at: FIXED_NOW - 4 * DAY }],
  });
  await setClock(page, FIXED_NOW);
  const userId = await seedState(page, makeState({ companions: [companion] }));
  if (o.consent !== false) await grantLiveConsent(userId);
  const health = trackHealth(page);
  await page.goto(`/chat/${o.id}`);
  await page.waitForURL(`**/chat/${o.id}`);
  return { userId, health };
}

async function send(page: Page, text: string) {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test.describe("E28 live chat with Ira", () => {
  test.describe.configure({ timeout: 60000 });

  test("E28.1: the opener arrives via the endpoint; the context card shows, then goes after about 5 s", async ({ page }) => {
    const { userId, health } = await open(page, { id: "c_e28_1", messages: [], createdAt: FIXED_NOW });
    await expect(page.getByText("you look like someone who reads the fine print")).toBeVisible({ timeout: 15000 });
    const card = page.getByTestId("context-card");
    await expect(card).toBeVisible();
    await screenshotScreen(page, "e28-01-open");
    await expect(card).toHaveCount(0, { timeout: 9000 });

    const snap = await serverSnapshot(userId);
    expect(snap.messages.filter((m) => m.who === "them")).toHaveLength(1);
    assertHealthy(health);
  });

  test("E28.2: the reaction shows on the user's bubble before Ira's reply appears", async ({ page }) => {
    const { health } = await open(page, { id: "c_e28_2" });
    await page.evaluate(() => {
      const t: Record<string, number> = {};
      (window as unknown as { __t: typeof t }).__t = t;
      new MutationObserver(() => {
        if (t.reaction === undefined && document.querySelector('[data-testid="reaction"]')) t.reaction = performance.now();
        if (t.bubble === undefined && document.body.innerText.includes("that's the third time")) t.bubble = performance.now();
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await send(page, "my manager moved the deadline again");
    await expect(page.getByTestId("reaction")).toHaveText("👀");
    await screenshotScreen(page, "e28-02-reaction");
    await expect(page.getByText("that's the third time")).toBeVisible({ timeout: 15000 });
    const t = await page.evaluate(() => (window as unknown as { __t: Record<string, number> }).__t);
    expect(t.reaction).toBeDefined();
    expect(t.reaction).toBeLessThan(t.bubble);
    assertHealthy(health);
  });

  test("E28.3: an ink bubble is blurred, then reveals on tap", async ({ page }) => {
    const { health } = await open(page, { id: "c_e28_3", level: 4 });
    await send(page, "ink please");
    const ink = page.getByTestId("ink");
    await expect(ink).toBeVisible({ timeout: 15000 });
    await expect(ink).toHaveAttribute("data-revealed", "false");
    await expect(page.getByText("Swipe or tap to reveal")).toBeVisible();
    const blur = await ink.locator("span").first().evaluate((el) => getComputedStyle(el).filter);
    expect(blur).toContain("blur");
    await screenshotScreen(page, "e28-03-ink");
    await ink.click();
    await expect(ink).toHaveAttribute("data-revealed", "true");
    await expect(page.getByText("Swipe or tap to reveal")).toHaveCount(0);
    assertHealthy(health);
  });

  test("E28.4: an acute band shows the resource card with three tel: links, and the composer stays usable", async ({ page }) => {
    const { userId, health } = await open(page, { id: "c_e28_4", level: 4 });
    await send(page, "acute please");
    const card = page.getByTestId("resource-card");
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.locator('a[href="tel:14416"]')).toHaveCount(1);
    await expect(card.locator('a[href="tel:9152987821"]')).toHaveCount(1);
    await expect(card.locator('a[href="tel:112"]')).toHaveCount(1);
    await expect(page.getByLabel("Message")).toBeEditable();
    await screenshotScreen(page, "e28-04-resource");
    // the reply is stripped of effects and carries the helplines
    await expect(page.locator("[data-effect]")).toHaveCount(0);
    await expect(page.getByText("14416").first()).toBeVisible();
    await card.getByRole("button", { name: "Dismiss" }).click();
    await expect(card).toHaveCount(0);

    // safety events store the kind only
    const { data } = await adminClient().from("safety_events").select("*").eq("user_id", userId);
    expect(data?.map((r) => r.kind)).toEqual(["acute"]);
    assertHealthy(health);
  });

  test("E28.5: an age claim pauses the chat behind the age check; an adult date of birth resumes it", async ({ page }) => {
    const { userId, health } = await open(page, { id: "c_e28_5" });
    await send(page, "i am 16 and bored");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Quick check")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("I need to check something before we keep talking.")).toBeVisible();
    await expect(page.getByLabel("Message")).toHaveCount(0);
    await screenshotScreen(page, "e28-05-age-check");
    // the default date of birth is 2002: an adult
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("Message")).toBeEditable();
    const snap = await serverSnapshot(userId);
    expect(snap.companions[0].paused_reason).toBeNull();
    assertHealthy(health);
  });

  test("E28.6: an effect the model asks for at L1 never renders (the server stripped it)", async ({ page }) => {
    const { health } = await open(page, { id: "c_e28_6", level: 1 });
    await send(page, "effect please");
    await expect(page.getByText("SLAM")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-effect]")).toHaveCount(0);
    await expect(page.getByTestId("reaction")).toHaveCount(0);
    await expect(page.getByText("second")).toHaveCount(0);
    assertHealthy(health);
  });

  test("E28.7: a mocked companion still uses replyFor and never calls the reply endpoint", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/chat/reply")) calls.push(r.url());
    });
    const { userId, health } = await open(page, { id: "c_e28_7", live: false });
    await send(page, "hello there");
    await expect.poll(async () => (await serverSnapshot(userId)).messages.filter((m) => m.who === "them").length, { timeout: 15000 }).toBe(2);
    expect(calls).toEqual([]);
    assertHealthy(health);
  });

  test("E28.10: two concurrent /api/chat/reply calls for the same message produce one reply", async ({ page }) => {
    const { userId } = await open(page, {
      id: "c_e28_10",
      messages: [
        { who: "them", text: "Hey.", at: FIXED_NOW - 4 * DAY },
        { who: "me", text: "hello there", at: FIXED_NOW - 3 * DAY },
      ],
    });
    const post = () => page.request.post("/api/chat/reply", { data: { companionId: "c_e28_10", mode: "reply" } });
    const results = await Promise.all([post(), post(), post()]);
    for (const r of results) expect([200, 202]).toContain(r.status());
    expect(results.some((r) => r.status() === 200)).toBe(true);
    const snap = await serverSnapshot(userId);
    const replies = snap.messages.filter((m) => m.who === "them");
    expect(replies).toHaveLength(2); // the seeded "Hey." plus exactly one reply
    // a later retry returns the same stored reply, not a new one
    const again = await post();
    if (again.status() === 200) expect((await again.json()).replayed).toBe(true);
    expect((await serverSnapshot(userId)).messages.filter((m) => m.who === "them")).toHaveLength(2);
  });

  test("E28.11: a reply that breaks the voice lint is regenerated once; only the second is stored", async ({ page }) => {
    const { userId, health } = await open(page, { id: "c_e28_11" });
    await send(page, "lint please");
    await expect(page.getByText("my flatmate tanvi is fine now")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("tanvi says hi")).toHaveCount(0);
    const snap = await serverSnapshot(userId);
    const them = snap.messages.filter((m) => m.who === "them").map((m) => m.text);
    expect(them).toEqual(["Hey.", "my flatmate tanvi is fine now"]);
    assertHealthy(health);
  });

  test("E28.12: the JSON retry ladder recovers from prose, a provider 400, and a 400 that only json_object survives", async ({ page }) => {
    const { userId, health } = await open(page, { id: "c_e28_12" });
    for (const trigger of ["json please", "invalid please", "ladder please"]) {
      const before = (await serverSnapshot(userId)).messages.filter((m) => m.who === "them").length;
      await send(page, trigger);
      await expect.poll(async () => (await serverSnapshot(userId)).messages.filter((m) => m.who === "them").length, { timeout: 25000, message: trigger }).toBe(before + 1);
      await expect(page.getByText(/couldn't reach ira/i)).toHaveCount(0);
    }
    await expect(page.getByText("got there in the end")).toHaveCount(3);
    assertHealthy(health);
  });

  test("E28.13: when all three attempts fail the user gets a 502 and the retry prompt, and the message stays", async ({ page }) => {
    const { userId } = await open(page, { id: "c_e28_13" });
    await send(page, "dead please");
    await expect(page.getByRole("button", { name: "Couldn't reach Ira. Tap to retry." })).toBeVisible({ timeout: 30000 });
    const snap = await serverSnapshot(userId);
    expect(snap.messages.filter((m) => m.who === "me").map((m) => m.text)).toEqual(["dead please"]);
    expect(snap.messages.filter((m) => m.who === "them")).toHaveLength(1); // only the seeded "Hey."
    expect(snap.companions[0].last_replied_msg).toBe(0); // the lock was released, so a retry can run
    const res = await page.request.post("/api/chat/reply", { data: { companionId: "c_e28_13", mode: "reply" } });
    expect(res.status()).toBe(502);
    expect(await res.json()).toEqual({ error: "reply_failed" });
  });

  test("E28.9: a cookie-less POST to /api/cron/vault gets a 401 JSON, never a redirect", async ({ playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL });
    for (const headers of [{}, { Authorization: "Bearer wrong" }]) {
      const res = await api.post("/api/cron/vault?job=daily", { headers, maxRedirects: 0 });
      expect(res.status()).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    // and the chat endpoint answers 401 itself rather than redirecting
    const chat = await api.post("/api/chat/reply", { data: { companionId: "c_x", mode: "reply" }, maxRedirects: 0 });
    expect(chat.status()).toBe(401);
    await api.dispose();
  });

  test("E28.8: reaching L6 plays petals on a canvas; reduced motion has no particles", async ({ page, browser }) => {
    const level5 = { id: "c_e28_8", level: 5, createdAt: FIXED_NOW - 70 * DAY };
    const arrange = async (userId: string) => {
      const { error } = await adminClient().from("companions").update({ trust_points: 900, signal_since_level: true }).eq("id", level5.id);
      if (error) throw error;
      void userId;
    };

    // with motion
    const first = await open(page, level5);
    await arrange(first.userId);
    await send(page, "this is a long enough message to count for a point today");
    await expect(page.getByTestId("screen-fx")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("screen-fx")).toHaveCount(0, { timeout: 8000 });
    const snap = await serverSnapshot(first.userId);
    expect(snap.companions[0]).toMatchObject({ trust_level: 6, highest_level: 6 });
    assertHealthy(first.health);

    // reduced motion
    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL: "http://127.0.0.1:3100" });
    const p2 = await ctx.newPage();
    // the wash lasts 400 ms, so record it instead of polling for it
    await p2.addInitScript(() => {
      const w = window as unknown as { __wash: boolean; __canvas: boolean };
      w.__wash = false;
      w.__canvas = false;
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="screen-wash"]')) w.__wash = true;
        if (document.querySelector("canvas")) w.__canvas = true;
      }).observe(document, { childList: true, subtree: true });
    });
    const second = await open(p2, { ...level5, id: "c_e28_8b" });
    await adminClient().from("companions").update({ trust_points: 900, signal_since_level: true }).eq("id", "c_e28_8b");
    await send(p2, "this is a long enough message to count for a point today");
    await expect.poll(() => p2.evaluate(() => (window as unknown as { __wash: boolean }).__wash), { timeout: 15000 }).toBe(true);
    await p2.waitForTimeout(1000);
    expect(await p2.evaluate(() => (window as unknown as { __canvas: boolean }).__canvas)).toBe(false);
    assertHealthy(second.health);
    await ctx.close();
  });
});
