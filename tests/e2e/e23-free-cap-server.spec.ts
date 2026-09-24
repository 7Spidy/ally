import { test, expect } from "@playwright/test";
import {
  FIXED_NOW,
  setClock,
  seedState,
  makeState,
  makeCompanion,
  trackHealth,
  assertHealthy,
  screenshotScreen,
  serverSnapshot,
  userClientFor,
} from "./helpers";

test.describe("E23 the free daily cap is enforced by send_message", () => {
  test("E23: sends up to the cap through the UI; the cap survives a reload and a direct RPC can't get past it", async ({ page, context }) => {
    const companion = makeCompanion({ id: "c_e23", templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 500000, exchanges: 3 });
    const state = makeState({ companions: [companion], ledger: { freeUsed: 98 } });

    await setClock(page, FIXED_NOW);
    const userId = await seedState(page, state);
    const health = trackHealth(page);

    await page.goto("/chat/c_e23");
    // 2 left: the normal composer, no warning bar yet
    await expect(page.getByLabel("Message")).toBeEditable();
    await expect(page.getByText("1 free message left today")).toHaveCount(0);

    await page.getByLabel("Message").fill("ninety-nine");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("1 free message left today")).toBeVisible();

    await page.getByLabel("Message").fill("one hundred");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("You're out of free messages for today")).toBeVisible();

    // The server holds the same count, not just the client cache.
    let snap = await serverSnapshot(userId);
    expect(snap.ledger).toMatchObject({ free_used: 100 });
    expect(snap.companions[0]).toMatchObject({ exchanges: 5 });
    expect(snap.messages.filter((m) => m.who === "me").map((m) => m.text)).toEqual(["ninety-nine", "one hundred"]);

    // A reload re-reads the server: still out of messages.
    await page.reload();
    await expect(page.getByText("You're out of free messages for today")).toBeVisible();
    await screenshotScreen(page, "e23-01-capped-after-reload");

    // Going around the UI: the same user's session calling the RPC directly
    // is refused, and a direct table write is not even permitted.
    const client = await userClientFor(context);
    const { data, error } = await client.rpc("send_message", { companion_id: "c_e23", body: "sneaky" });
    expect(error).toBeNull();
    expect(data).toMatchObject({ blocked: true, status: "empty", message: null });
    const write = await client.from("ledgers").update({ free_used: 0 }).eq("user_id", userId);
    expect(write.error?.code).toBe("42501");

    snap = await serverSnapshot(userId);
    expect(snap.ledger).toMatchObject({ free_used: 100 });
    expect(snap.messages.some((m) => m.text === "sneaky")).toBe(false);

    assertHealthy(health);
  });
});
