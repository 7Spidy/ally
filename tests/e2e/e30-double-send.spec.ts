import { test, expect, type Page } from "@playwright/test";
import { FIXED_NOW, adminClient, assertHealthy, grantLiveConsent, makeCompanion, makeState, romanticCore, seedState, setClock, trackHealth } from "./helpers";

// A message sent while the previous reply is still in flight must get a correctly
// framed follow-up (here: a tapback alone, from the mock), never a fresh opener.
// The LLM base URL points at /api/test/llm-mock and E2E_MOCKS=1 (playwright.config.ts).

const DAY = 86400000;
const OPENER_TEXT = "you look like someone who reads the fine print";

async function open(page: Page, id: string) {
  const companion = makeCompanion({
    id,
    templateId: "F01",
    deckGender: "woman",
    createdAt: FIXED_NOW - 5 * DAY,
    core: romanticCore(),
    trustLevel: 1,
    pausedReason: null,
    messages: [{ who: "them", text: "Hey.", at: FIXED_NOW - 4 * DAY }],
  });
  await setClock(page, FIXED_NOW);
  const userId = await seedState(page, makeState({ companions: [companion] }));
  await grantLiveConsent(userId);
  const health = trackHealth(page);
  await page.goto(`/chat/${id}`);
  await page.waitForURL(`**/chat/${id}`);
  return { userId, health };
}

async function send(page: Page, text: string) {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test.describe("E30 double send", () => {
  test.describe.configure({ timeout: 90000 });

  test("E30.1: a message sent mid-reply gets a tapback, not a restart", async ({ page }) => {
    const id = "c_e30_1";
    const { userId, health } = await open(page, id);

    // The mock holds this reply for about 4 s, so it has loaded its history before the second message exists.
    await send(page, "slow please");
    await page.waitForTimeout(1000);
    await send(page, "second one");

    // Reply 1 lands once; the follow-up is a reaction on "second one" and no bubble.
    await expect(page.getByText("noted.", { exact: true })).toHaveCount(1, { timeout: 20000 });
    await expect(page.getByTestId("reaction")).toHaveText("👍", { timeout: 20000 });
    await expect(page.getByTestId("typing")).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByText(OPENER_TEXT)).toHaveCount(0);
    await expect(page.getByText("noted.", { exact: true })).toHaveCount(1);

    const db = adminClient();
    const { data: msgs } = await db.from("messages").select("id,who,text,in_reply_to,meta").eq("companion_id", id).order("id");
    const rows = (msgs ?? []) as { id: number; who: string; text: string; in_reply_to: number | null; meta: { reaction?: string } | null }[];
    const second = rows.find((m) => m.who === "me" && m.text === "second one");
    expect(second).toBeDefined();
    expect(rows.filter((m) => m.who === "them" && m.in_reply_to === second!.id)).toHaveLength(0);
    expect(second!.meta?.reaction).toBe("👍");
    expect(rows.some((m) => m.who === "them" && m.text.includes(OPENER_TEXT))).toBe(false);
    const { data: comp } = await db.from("companions").select("last_replied_msg").eq("id", id).maybeSingle();
    expect(comp?.last_replied_msg).toBe(second!.id);
    expect(userId).toBeTruthy();

    // A refresh replays the finished state: no duplicate bubble, no typing dots, the reaction still there.
    await page.reload();
    await page.waitForURL(`**/chat/${id}`);
    await expect(page.getByText("second one")).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2500);
    await expect(page.getByText("noted.", { exact: true })).toHaveCount(1);
    await expect(page.getByTestId("typing")).toHaveCount(0);
    await expect(page.getByTestId("reaction")).toHaveText("👍");
    assertHealthy(health);
  });
});
