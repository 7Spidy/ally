import { test, expect, type Page } from "@playwright/test";
import persona from "../../src/personas/F01.persona.json";
import {
  FIXED_NOW,
  acceptLiveConsent,
  adminClient,
  answerSevenQuestions,
  assertHealthy,
  driveFirstRunIntro,
  driveMatchingThroughChat,
  grantSeptemberConsent,
  makeCompanion,
  makeState,
  romanticCore,
  screenshotScreen,
  seedState,
  setClock,
  trackHealth,
} from "./helpers";

// U1 UX fixes (docs: claude_change_spec.md). The LLM base URL points at
// /api/test/llm-mock and E2E_MOCKS=1 (playwright.config.ts), so a reply to
// ordinary text is the canned single bubble "noted.".

const DAY = 86400000;
const REPLY = "noted.";

interface Msg {
  who: "them" | "me";
  text: string;
  at: number;
  meta?: Record<string, unknown>;
}

interface Opts {
  id: string;
  messages?: Msg[];
  exchanges?: number;
  level?: number;
  accountAt?: number | null;
  plan?: "trial" | "max";
  extra?: { id: string; templateId: string; deckGender: "woman" | "man"; messages?: Msg[] }[];
  consent?: "live" | "september" | "none";
  realClock?: boolean;
}

/** Opens a live chat with Ira (F01 and a ROMANTIC core). With `realClock` the page runs on the real clock, for date labels. */
async function open(page: Page, o: Opts) {
  const base = o.realClock ? Date.now() : FIXED_NOW;
  const companion = makeCompanion({
    id: o.id,
    templateId: "F01",
    deckGender: "woman",
    createdAt: base - 6 * DAY,
    core: romanticCore(),
    trustLevel: o.level ?? 1,
    exchanges: o.exchanges ?? 0,
    messages: o.messages ?? [{ who: "them", text: "Hey.", at: base - 4 * DAY }],
  });
  const extras = (o.extra ?? []).map((e) =>
    makeCompanion({ id: e.id, templateId: e.templateId, deckGender: e.deckGender, createdAt: base - 5 * DAY, core: romanticCore(), messages: e.messages ?? [{ who: "them", text: "Hello.", at: base - 3 * DAY }] })
  );
  if (!o.realClock) await setClock(page, FIXED_NOW);
  const user = o.accountAt === null ? { accountAt: null, accountContact: null, accountKind: null } : {};
  const userId = await seedState(page, makeState({ companions: [companion, ...extras], plan: o.plan ?? "trial", user, now: base }));
  if (o.consent === "september") await grantSeptemberConsent(userId);
  const health = trackHealth(page);
  await page.goto(`/chat/${o.id}`);
  await page.waitForURL(`**/chat/${o.id}`);
  return { userId, health };
}

async function send(page: Page, text: string) {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

const replies = (page: Page) => page.getByText(REPLY, { exact: true });

test.describe("E32 U1 UX fixes", () => {
  test.describe.configure({ timeout: 90000 });

  // ---- P0-2 -----------------------------------------------------------------
  test("E32.1: a non-QA user has no test buttons, and a forced ping does not reach a companion active a minute ago", async ({ page }) => {
    const id = "c_e32_1";
    await setClock(page, FIXED_NOW);
    const companion = makeCompanion({ id, templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 5 * DAY, core: romanticCore(), messages: [{ who: "me", text: "hi", at: FIXED_NOW - 60_000 }] });
    await seedState(page, makeState({ companions: [companion] }));
    const qaCheck = page.waitForResponse((r) => r.url().includes("/rpc/is_qa"));
    await page.goto("/settings/notifications");
    await qaCheck;
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Test (Ping|Midday|Evening)/ })).toHaveCount(0);
    await expect(page.getByText(/Test Ping/)).toHaveCount(0);

    const res = await page.request.post("/api/chat/ping", { data: { companionId: id, force: true } });
    expect(res.ok()).toBe(true);
    expect(await res.json()).toMatchObject({ pinged: false, reason: "too_soon" });
  });

  test("E32.2: a QA user still sees the test buttons", async ({ page }) => {
    const id = "c_e32_2";
    await setClock(page, FIXED_NOW);
    const companion = makeCompanion({ id, templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 5 * DAY, core: romanticCore() });
    const userId = await seedState(page, makeState({ companions: [companion] }));
    await adminClient().from("profiles").update({ role: "qa" }).eq("id", userId);
    await page.goto("/settings/notifications");
    await expect(page.getByRole("button", { name: /Test Midday Reminder/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /Test Evening Reminder/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Test Ping from/ })).toBeVisible();
  });

  // ---- P0-3 -----------------------------------------------------------------
  test("E32.3: a fresh onboarding reaches the first chat with no consent sheet", async ({ page }) => {
    await setClock(page, FIXED_NOW);
    const health = trackHealth(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Get started" }).click();
    await page.waitForURL("**/onboarding/consent");
    await expect(page.getByText("Your companion's replies are written by an AI model. They remember key things you tell them, so conversations carry over.")).toBeVisible();
    await driveFirstRunIntro(page, { name: "Riya", city: "Mumbai", gender: "woman" });
    await answerSevenQuestions(page);
    await driveMatchingThroughChat(page);
    await expect(page).toHaveURL(/\/chat\/c_/);
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
    await page.waitForTimeout(2000);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    assertHealthy(health);
  });

  test("E32.4: a user on the September consent sees the reworded sheet once", async ({ page }) => {
    const id = "c_e32_4";
    await open(page, { id, consent: "september" });
    const sheet = page.getByRole("dialog").filter({ hasText: "One update before you chat" });
    await expect(sheet).toBeVisible({ timeout: 10000 });
    await expect(sheet.getByText("Ira's replies are written by an AI model. Ira remembers key things you tell her, so conversations carry over.")).toBeVisible();
    await expect(sheet.getByText("You can see and delete what Ira remembers on the profile, or delete everything in Settings.")).toBeVisible();
    // The sheet cannot be dismissed by a tap outside it.
    await page.getByTestId("sheet-scrim").click({ position: { x: 5, y: 5 } });
    await expect(sheet).toBeVisible();
    await screenshotScreen(page, "e32-01-consent-update");
    await sheet.getByRole("button", { name: "Continue" }).click();
    await expect(sheet).toHaveCount(0);
    await page.reload();
    await page.waitForURL(`**/chat/${id}`);
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("E32.5: the account sheet stays shut after exchange 1 and opens once her reply to the third has landed", async ({ page }) => {
    const id = "c_e32_5";
    await open(page, { id, accountAt: null });
    await send(page, "first one");
    await expect(replies(page)).toHaveCount(1, { timeout: 25000 });
    await page.waitForTimeout(1500);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await send(page, "second one");
    await expect(replies(page)).toHaveCount(2, { timeout: 25000 });
    await page.waitForTimeout(1500);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await send(page, "third one");
    // Not while her third reply is still on its way.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(replies(page)).toHaveCount(3, { timeout: 25000 });
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Email")).toBeVisible({ timeout: 10000 });
    await screenshotScreen(page, "e32-02-account-sheet-third");
    // At exchange 3 it is dismissible: a tap outside closes it.
    await page.getByTestId("sheet-scrim").click({ position: { x: 5, y: 5 } });
    await expect(sheet).toHaveCount(0);
  });

  test("E32.6: the blocking account sheet ignores a tap on the scrim", async ({ page }) => {
    await open(page, { id: "c_e32_6", accountAt: null, exchanges: 7 });
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Email")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("sheet-scrim").click({ position: { x: 5, y: 5 } });
    await expect(sheet.getByLabel("Email")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Not now" })).toHaveCount(0);
  });

  // ---- P1-6, P1-7 -------------------------------------------------------------
  test("E32.7: a failed send gives the text back; a good send shows the bubble before the RPC answers", async ({ page }) => {
    await open(page, { id: "c_e32_7" });
    // Fail the first send.
    await page.route("**/rest/v1/rpc/send_message", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) }), { times: 1 });
    await send(page, "this will fail");
    await expect(page.getByLabel("Message")).toHaveValue("this will fail", { timeout: 10000 });
    await expect(page.getByTestId("bubble-pending")).toHaveCount(0);
    await expect(page.getByText("this will fail")).toHaveCount(1); // only in the box, no bubble

    // Hold the second send.
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route(
      "**/rest/v1/rpc/send_message",
      async (route) => {
        await held;
        await route.continue();
      },
      { times: 1 }
    );
    await page.getByRole("button", { name: "Send" }).click();
    const pending = page.getByTestId("bubble-pending");
    await expect(pending).toHaveCount(1);
    await expect(pending).toContainText("this will fail");
    await expect(pending).toHaveCSS("opacity", "0.6");
    await expect(page.getByLabel("Message")).toHaveValue("");
    await screenshotScreen(page, "e32-03-pending-bubble");
    release();
    await expect(page.getByTestId("bubble-pending")).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByText("this will fail")).toHaveCount(1);
    await expect(replies(page)).toHaveCount(1, { timeout: 25000 });
  });

  test("E32.8: a multiline message keeps its line break and the box grows; a draft survives a reload", async ({ page }) => {
    const id = "c_e32_8";
    await open(page, { id });
    const box = page.getByLabel("Message");
    const oneLine = (await box.boundingBox())!.height;
    await box.fill("line one\nline two\nline three");
    expect((await box.boundingBox())!.height).toBeGreaterThan(oneLine + 20);
    await box.fill("line one\nline two");
    await page.getByRole("button", { name: "Send" }).click();
    const bubble = page.locator("div[id^='m-']", { hasText: "line one" }).locator("div[class*='bubble']").first();
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveCSS("white-space", "pre-wrap");
    expect(await bubble.innerText()).toBe("line one\nline two");
    await screenshotScreen(page, "e32-04-multiline");

    await box.fill("an unsent thought");
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForURL(`**/chat/${id}`);
    await expect(page.getByLabel("Message")).toHaveValue("an unsent thought", { timeout: 10000 });
    // Sending clears it for good.
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByLabel("Message")).toHaveValue("");
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForURL(`**/chat/${id}`);
    await expect(page.getByLabel("Message")).toHaveValue("");
  });

  test.describe("with a mouse and keyboard", () => {
    test.use({ hasTouch: false, isMobile: false });

    test("E32.9: Enter sends and Shift+Enter adds a line", async ({ page }) => {
      await open(page, { id: "c_e32_9" });
      const box = page.getByLabel("Message");
      await box.click();
      await box.pressSequentially("hello");
      await box.press("Shift+Enter");
      await box.pressSequentially("again");
      await expect(box).toHaveValue("hello\nagain");
      await box.press("Enter");
      await expect(box).toHaveValue("");
      await expect(page.getByText("hello", { exact: false }).first()).toBeVisible();
      await expect(replies(page)).toHaveCount(1, { timeout: 25000 });
    });
  });

  test("E32.10: on touch, Enter is a line break", async ({ page }) => {
    await open(page, { id: "c_e32_10" });
    const box = page.getByLabel("Message");
    await box.click();
    await box.pressSequentially("one");
    await box.press("Enter");
    await box.pressSequentially("two");
    await expect(box).toHaveValue("one\ntwo");
    await expect(page.getByTestId("bubble-pending")).toHaveCount(0);
  });

  // ---- P1-8, P1-9 -------------------------------------------------------------
  test("E32.11: Delivered shows before Read, and Read comes once she has had time to read it", async ({ page }) => {
    await open(page, { id: "c_e32_11" });
    await send(page, "are you there");
    const receipt = page.getByTestId("receipt");
    await expect(receipt).toHaveText("Delivered", { timeout: 5000 });
    await expect(receipt).toHaveText("Read", { timeout: 20000 });
    await expect(replies(page)).toHaveCount(1, { timeout: 25000 });
  });

  // ---- P1-10, P1-11 -----------------------------------------------------------
  const run = (n: number, base: number): Msg[] => Array.from({ length: n }, (_, i) => ({ who: i % 2 === 0 ? "me" : "them", text: `m${String(i).padStart(3, "0")}`, at: base + i * 60_000 }));

  test("E32.12: 120 messages show the newest 50, load more on scroll up and keep the reading position, and a quote to an unloaded message jumps to it", async ({ page }) => {
    const id = "c_e32_12";
    const base = FIXED_NOW - 5 * DAY;
    const messages = run(120, base);
    const { userId } = await open(page, { id, messages });
    // The last message quotes m005, far outside the loaded window.
    const db = adminClient();
    const { data: rows } = await db.from("messages").select("id,text").eq("companion_id", id).order("id");
    const byText = new Map((rows ?? []).map((r) => [r.text as string, r.id as number]));
    await db.from("messages").update({ meta: { quoteId: byText.get("m005") } }).eq("id", byText.get("m119")!);
    await page.reload();
    await page.waitForURL(`**/chat/${id}`);
    void userId;

    const bubbles = page.locator("[data-testid='message-list'] div[id^='m-']");
    await expect(bubbles).toHaveCount(50, { timeout: 15000 });
    await expect(page.getByText("m119")).toBeVisible();
    await expect(page.getByText("m070", { exact: true })).toBeAttached();
    await expect(page.getByText("m069", { exact: true })).toHaveCount(0);

    // Scroll to the top: the previous page loads without moving what is being read.
    const list = page.getByTestId("message-list");
    await list.evaluate((el) => (el.scrollTop = 0));
    const topBefore = await page.getByText("m070", { exact: true }).evaluate((el) => el.getBoundingClientRect().top);
    await expect(bubbles).toHaveCount(100, { timeout: 15000 });
    await expect(page.getByTestId("loading-older")).toHaveCount(0, { timeout: 5000 });
    const topAfter = await page.getByText("m070", { exact: true }).evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(topAfter - topBefore)).toBeLessThan(60);
    await screenshotScreen(page, "e32-05-paged");

    await list.evaluate((el) => (el.scrollTop = 0));
    await expect(bubbles).toHaveCount(120, { timeout: 15000 });

    // A fresh load, then the quote: only 50 are loaded, so the jump has to page back.
    await page.reload();
    await page.waitForURL(`**/chat/${id}`);
    await expect(bubbles).toHaveCount(50, { timeout: 15000 });
    await page.getByTestId("quote").click();
    // The quote's own preview also reads m005, so take the bubble itself (first in the DOM).
    const target = page.getByText("m005", { exact: true }).first();
    await expect(target).toBeVisible({ timeout: 15000 });
    await expect(page.locator("div[id^='m-'] div[data-flash='true']")).toHaveCount(1);
  });

  test("E32.13: a date separator sits between days, and a tap on a bubble shows its time", async ({ page }) => {
    const now = Date.now();
    await open(page, {
      id: "c_e32_13",
      realClock: true,
      messages: [
        { who: "them", text: "two days ago", at: now - 2 * DAY },
        { who: "me", text: "yesterday evening", at: now - DAY },
        { who: "them", text: "just now", at: now - 60_000 },
      ],
    });
    const seps = page.getByTestId("date-sep");
    await expect(seps).toHaveCount(3);
    await expect(seps.nth(1)).toHaveText("Yesterday");
    await expect(seps.nth(2)).toHaveText("Today");
    await expect(seps.nth(0)).toHaveText(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}( \d{4})?$/);
    await screenshotScreen(page, "e32-06-date-separators");

    await page.getByText("yesterday evening", { exact: true }).click();
    await expect(page.getByTestId("bubble-time")).toHaveCount(1);
    await expect(page.getByTestId("bubble-time")).toHaveText(/^\d{1,2}:\d{2} (am|pm)$/);
    await page.getByText("just now", { exact: true }).click();
    await expect(page.getByTestId("bubble-time")).toHaveCount(1); // one at a time
    await page.getByText("just now", { exact: true }).click();
    await expect(page.getByTestId("bubble-time")).toHaveCount(0);
  });

  test("E32.14: the jump pill shows when scrolled well up, and takes you back to the latest", async ({ page }) => {
    await open(page, { id: "c_e32_14", messages: run(40, FIXED_NOW - 2 * DAY) });
    const pill = page.getByTestId("jump-latest");
    await expect(pill).toHaveAttribute("data-visible", "false");
    const list = page.getByTestId("message-list");
    await list.evaluate((el) => (el.scrollTop = 0));
    await expect(pill).toHaveAttribute("data-visible", "true");
    await expect(pill).toHaveAccessibleName("Jump to latest");
    await screenshotScreen(page, "e32-07-jump-pill");
    await pill.click();
    await expect(pill).toHaveAttribute("data-visible", "false", { timeout: 5000 });
    await expect
      .poll(() => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight), { timeout: 5000 })
      .toBeLessThan(40);
  });

  // ---- P2-14 ------------------------------------------------------------------
  test("E32.15: the profile shows the bio, the stage name and what she remembers; deleting a fact is permanent", async ({ page }) => {
    const id = "c_e32_15";
    await setClock(page, FIXED_NOW);
    const companion = makeCompanion({ id, templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 6 * DAY, core: romanticCore(), trustLevel: 2 });
    const userId = await seedState(page, makeState({ companions: [companion] }));
    const db = adminClient();
    await db.from("memory_facts").insert([
      { companion_id: id, user_id: userId, category: "people", fact: "Your sister Meera lives in Pune", source_day: "2026-11-01" },
      { companion_id: id, user_id: userId, category: "work", fact: "You are redoing a portfolio", source_day: "2026-11-02" },
    ]);
    await page.goto(`/profile/${id}`);
    const bio = page.getByTestId("profile-bio");
    await expect(bio).toContainText("Delhi");
    await expect(bio).toContainText("Junior architect");
    await expect(bio).toContainText("Reads as composed");
    const stage = page.getByTestId("profile-stage");
    await expect(stage).toContainText("Where you are");
    await expect(stage).toContainText(persona.levels[1].name);
    await expect(stage).not.toContainText(/\d/);
    await expect(page.getByRole("heading", { name: "What Ira remembers" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Work" })).toBeVisible();
    await expect(page.getByTestId("memory-fact")).toHaveCount(2);
    await screenshotScreen(page, "e32-08-profile");

    const row = page.getByTestId("memory-fact").filter({ hasText: "Meera" });
    await row.getByRole("button", { name: "Delete" }).click(); // arms
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Delete" }).click(); // deletes
    await expect(page.getByTestId("memory-fact")).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId("memory-fact")).toHaveCount(1);
    await expect(page.getByText("Meera")).toHaveCount(0);
    const { data } = await db.from("memory_facts").select("id").eq("companion_id", id);
    expect(data).toHaveLength(1);
  });

  test("E32.16: with nothing remembered the profile says so", async ({ page }) => {
    const id = "c_e32_16";
    await setClock(page, FIXED_NOW);
    const companion = makeCompanion({ id, templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 6 * DAY, core: romanticCore() });
    await seedState(page, makeState({ companions: [companion] }));
    await page.goto(`/profile/${id}`);
    await expect(page.getByTestId("memory-empty")).toHaveText("Nothing yet. This fills in as you talk.");
  });

  // ---- P2-15 ------------------------------------------------------------------
  test("E32.17: Download my data saves the server's export as ally-data.json", async ({ page }) => {
    const id = "c_e32_17";
    await setClock(page, FIXED_NOW);
    const companion = makeCompanion({ id, templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 6 * DAY, core: romanticCore(), messages: [{ who: "them", text: "kept in the export", at: FIXED_NOW - DAY }] });
    await seedState(page, makeState({ companions: [companion] }));
    await page.goto("/settings/privacy");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download my data" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("ally-data.json");
    const path = await file.path();
    const text = await (await import("node:fs/promises")).readFile(path!, "utf8");
    const data = JSON.parse(text) as { companions: { id: string }[]; messages: { text: string | null }[]; entitlement: { plan: string } };
    expect(data.companions.map((c) => c.id)).toContain(id);
    expect(data.messages.some((m) => m.text === "kept in the export")).toBe(true);
    expect(data.entitlement.plan).toBe("trial");
    expect(text).not.toMatch(/trust_points|fair_use|pass_cap/);
  });

  // ---- P2-17 ------------------------------------------------------------------
  test("E32.18: the overflow menu offers Switch companion (with two Allys), Pinned messages and Profile, and closes on an outside tap or Escape", async ({ page }) => {
    await open(page, { id: "c_e32_18", plan: "max", extra: [{ id: "c_e32_18b", templateId: "M01", deckGender: "man" }] });
    await page.getByRole("button", { name: "More" }).click();
    const items = page.getByRole("menuitem");
    await expect(items).toHaveText(["Switch companion", "Pinned messages", "Profile"]);
    await screenshotScreen(page, "e32-09-overflow");
    await page.getByTestId("overflow-backdrop").click({ position: { x: 20, y: 400 } });
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    // Switch companion opens the switcher, and a tap on its scrim closes it.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Switch companion" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Switch to")).toBeVisible();
    await page.getByTestId("sheet-scrim").click({ position: { x: 5, y: 5 } });
    await expect(sheet).toHaveCount(0);
  });

  test("E32.19: with one Ally the menu has no Switch companion", async ({ page }) => {
    await open(page, { id: "c_e32_19" });
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Pinned messages", "Profile"]);
  });

  // ---- P2-19 ------------------------------------------------------------------
  test("E32.20: Pinned messages lists her pins and jumps to one; an empty chat says nothing is pinned", async ({ page }) => {
    const base = FIXED_NOW - 4 * DAY;
    const messages: Msg[] = [
      { who: "them", text: "keep this one", at: base, meta: { effect: "pin" } },
      ...run(60, base + 60_000),
    ];
    await open(page, { id: "c_e32_20", messages });
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Pinned messages" }).click();
    const rows = page.getByTestId("pinned-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("keep this one");
    await screenshotScreen(page, "e32-10-pinned");
    await rows.first().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The pin is older than the 50 loaded, so the jump paged back to it.
    await expect(page.getByText("keep this one", { exact: true }).first()).toBeVisible({ timeout: 15000 });
  });

  test("E32.21: an empty pinned list says so", async ({ page }) => {
    await open(page, { id: "c_e32_21" });
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Pinned messages" }).click();
    await expect(page.getByTestId("pins-empty")).toHaveText("Nothing pinned yet.");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  async function editFirstMessage(page: Page, from: string, to: string) {
    await page.getByText(from, { exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const box = page.getByLabel("Message");
    await expect(box).toHaveValue(from);
    await box.fill(to);
    await page.getByRole("button", { name: "Save" }).click();
  }

  test("E32.22: editing the newest answered message replaces her reply", async ({ page }) => {
    const id = "c_e32_22";
    const { userId } = await open(page, { id });
    await send(page, "my first draft");
    await expect(replies(page)).toHaveCount(1, { timeout: 25000 });
    const db = adminClient();
    const before = await db.from("messages").select("id,who,text,in_reply_to").eq("companion_id", id).eq("who", "them").neq("text", "Hey.");
    const oldReplyIds = (before.data ?? []).map((m) => m.id as number);
    expect(oldReplyIds).toHaveLength(1);
    const trustBefore = (await db.from("companions").select("trust_points,exchanges").eq("id", id).single()).data;

    await editFirstMessage(page, "my first draft", "my better draft");
    await expect(page.getByText("my better draft", { exact: true })).toBeVisible();
    // Her old reply goes and a new one arrives.
    await expect.poll(async () => {
      const { data } = await db.from("messages").select("id").eq("companion_id", id).eq("who", "them").neq("text", "Hey.");
      const ids = (data ?? []).map((m) => m.id as number);
      return ids.length === 1 && !oldReplyIds.includes(ids[0]);
    }, { timeout: 25000 }).toBe(true);
    await expect(replies(page)).toHaveCount(1, { timeout: 25000 });

    const mine = await db.from("messages").select("id,meta,text").eq("companion_id", id).eq("who", "me").single();
    expect(mine.data?.text).toBe("my better draft");
    expect(mine.data?.meta).not.toHaveProperty("regen");
    const reply = await db.from("messages").select("in_reply_to").eq("companion_id", id).eq("who", "them").neq("text", "Hey.").single();
    expect(reply.data?.in_reply_to).toBe(mine.data?.id);
    // No new exchange: trust points and the exchange count are where they were, and one chat was charged.
    const trustAfter = (await db.from("companions").select("trust_points,exchanges").eq("id", id).single()).data;
    expect(trustAfter).toEqual(trustBefore);
    const ledger = (await db.from("ledgers").select("free_used").eq("user_id", userId).single()).data;
    expect(ledger?.free_used).toBe(1);
  });

  test("E32.23: editing an older message does not touch her replies", async ({ page }) => {
    const id = "c_e32_23";
    await open(page, { id });
    await send(page, "first thing");
    await expect(replies(page)).toHaveCount(1, { timeout: 25000 });
    await send(page, "second thing");
    await expect(replies(page)).toHaveCount(2, { timeout: 25000 });
    const db = adminClient();
    const idsOf = async () => ((await db.from("messages").select("id").eq("companion_id", id).eq("who", "them").neq("text", "Hey.").order("id")).data ?? []).map((m) => m.id as number);
    const before = await idsOf();
    await editFirstMessage(page, "first thing", "first thing, reworded");
    await expect(page.getByText("first thing, reworded", { exact: true })).toBeVisible();
    await page.waitForTimeout(4000);
    expect(await idsOf()).toEqual(before);
    await expect(replies(page)).toHaveCount(2);
  });

  // ---- P2-15 web app ----------------------------------------------------------
  test("E32.24: the manifest, the service worker and the icons are served without a session", async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    const manifest = await anon.get("/manifest.webmanifest", { maxRedirects: 0 });
    expect(manifest.status()).toBe(200);
    const m = (await manifest.json()) as { name: string; short_name: string; start_url: string; display: string; background_color: string; theme_color: string; icons: { src: string }[] };
    expect(m).toMatchObject({ name: "Ally", short_name: "Ally", start_url: "/", display: "standalone", background_color: "#151220", theme_color: "#151220" });
    expect(m.icons.map((i) => i.src).sort()).toEqual(["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"]);
    const sw = await anon.get("/sw.js", { maxRedirects: 0 });
    expect(sw.status()).toBe(200);
    expect(sw.headers()["content-type"]).toMatch(/javascript/);
    expect(await sw.text()).toContain("skipWaiting");
    for (const icon of m.icons) {
      const r = await anon.get(icon.src, { maxRedirects: 0 });
      expect(r.status(), icon.src).toBe(200);
      expect(r.headers()["content-type"]).toMatch(/image\/png/);
    }
    await anon.dispose();
  });

  test("E32.25: a consent that is not the September one is not asked again (acceptLiveConsent is a no-op)", async ({ page }) => {
    await open(page, { id: "c_e32_25" });
    await acceptLiveConsent(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
