import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  adminClient,
  assertHealthy,
  assertMinFontSize,
  createUser,
  loginWithPassword,
  makeCompanion,
  makeState,
  screenshotScreen,
  seedPlan,
  seedServerState,
  serverSnapshot,
  trackHealth,
  uniqueEmail,
  userClientFor,
  FIXED_NOW,
} from "./helpers";

// P3 admin console (docs/specs/p3-admin-console.md §7). The admin is a
// linked account promoted by hand in SQL, as the manual checklist does.

const PASSWORD = "admin console pw 123";

async function makeAdmin(): Promise<{ email: string; id: string }> {
  const email = uniqueEmail();
  const id = await createUser(email, PASSWORD);
  const { error } = await adminClient().from("profiles").update({ role: "admin" }).eq("id", id);
  if (error) throw error;
  return { email, id };
}

/** A linked user with one companion (id `companionId`), no messages sent yet today. */
async function makeMember(companionId: string): Promise<{ email: string; id: string }> {
  const email = uniqueEmail();
  const id = await createUser(email, PASSWORD);
  const companion = makeCompanion({ id: companionId, templateId: "F01", deckGender: "woman", createdAt: FIXED_NOW - 500000 });
  await seedServerState(id, makeState({ companions: [companion] }));
  return { email, id };
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await loginWithPassword(page, email, PASSWORD);
  // An admin with no companions lands on /home, a member on their chat.
  await page.waitForURL((u) => u.pathname === "/home" || u.pathname.startsWith("/chat/"), { timeout: 15000 });
  return page;
}

/** Admin: search the list by email and open that user's page. */
async function openUser(admin: Page, email: string, id: string) {
  await admin.goto("/admin");
  await admin.getByLabel("Search by email").fill(email);
  await admin.getByRole("button", { name: "Search" }).click();
  await admin.waitForURL(/\/admin\?q=/);
  const users = admin.getByRole("list", { name: "Users" });
  await expect(users.getByRole("listitem")).toHaveCount(1);
  await users.getByRole("link", { name: new RegExp(email.replace(/[.+]/g, "\\$&")) }).click();
  await admin.waitForURL(`**/admin/users/${id}`);
}

test.describe("E27 admin console", () => {
  // Several independent sign-ins per test.
  test.describe.configure({ timeout: 120000 });

  test("E27a: an admin finds a user, suspends them (their send fails), unsuspends, sees their plan and sets a limit; the user's app reflects each", async ({
    browser,
  }) => {
    const admin = await makeAdmin();
    const member = await makeMember("c_e27a");

    const adminPage = await signedIn(browser, admin.email);
    const health = trackHealth(adminPage);
    const userPage = await signedIn(browser, member.email);
    await userPage.goto("/chat/c_e27a");
    await expect(userPage.getByLabel("Message")).toBeEditable();

    await openUser(adminPage, member.email, member.id);
    await expect(adminPage.getByRole("heading", { name: member.email })).toBeVisible();
    await expect(adminPage.getByText("Active", { exact: true }).first()).toBeVisible();
    await screenshotScreen(adminPage, "e27-01-user-detail");
    await assertMinFontSize(adminPage);

    // Suspend: the page re-reads the server and flips the control.
    await adminPage.getByRole("button", { name: "Suspend account" }).click();
    await expect(adminPage.getByRole("button", { name: "Unsuspend account" })).toBeVisible();
    await expect(adminPage.getByText("Suspended", { exact: true }).first()).toBeVisible();
    await expect(adminPage.getByRole("list", { name: "Admin history" }).getByText("Suspended")).toBeVisible();

    // The user, in their own browser, can no longer send.
    await userPage.getByLabel("Message").fill("am I still here?");
    await userPage.getByRole("button", { name: "Send" }).click();
    await expect(userPage.getByText("Your account is paused, so this can't go through right now.")).toBeVisible();
    await screenshotScreen(userPage, "e27-02-suspended-send");
    let snap = await serverSnapshot(member.id);
    expect(snap.messages.some((m) => m.text === "am I still here?")).toBe(false);
    expect(snap.ledger).toMatchObject({ free_used: 0 });

    // Unsuspend, then put the member on Pro through the purchase entry point: the console shows
    // the plan, and the user's home drops the trial chips.
    await adminPage.getByRole("button", { name: "Unsuspend account" }).click();
    await expect(adminPage.getByRole("button", { name: "Suspend account" })).toBeVisible();
    await seedPlan(member.id, "pro");
    await adminPage.reload();
    await expect(adminPage.getByText("Pro", { exact: true }).first()).toBeVisible();
    snap = await serverSnapshot(member.id);
    expect(snap.subscription).toMatchObject({ plan: "pro", status: "active" });

    await userPage.goto("/home");
    await expect(userPage.getByTestId("trial-chip")).toHaveCount(0);

    // Back to the trial and lower the trial's daily chats: the user's chip follows the override.
    await seedPlan(member.id, "trial");
    await adminPage.reload();
    await adminPage.getByLabel("Trial chats per day").fill("4");
    await adminPage.getByRole("button", { name: "Save" }).first().click();
    await expect(adminPage.getByText("Override (4)")).toBeVisible();

    await userPage.reload();
    await expect(userPage.getByText("4 left today")).toBeVisible();

    const history = adminPage.getByRole("list", { name: "Admin history" });
    await expect(history.getByRole("listitem")).toHaveCount(3);
    await expect(history.getByText("Changed trial daily chats: default → 4")).toBeVisible();
    await screenshotScreen(adminPage, "e27-03-history");

    assertHealthy(health);
    await adminPage.context().close();
    await userPage.context().close();
  });

  test("E27b: 'Log out everywhere' from the console bounces every session of that user on its next navigation", async ({ browser }) => {
    const admin = await makeAdmin();
    const member = await makeMember("c_e27b");

    const adminPage = await signedIn(browser, admin.email);
    const phone = await signedIn(browser, member.email);
    const laptop = await signedIn(browser, member.email);

    await openUser(adminPage, member.email, member.id);
    await adminPage.getByRole("button", { name: "Log out everywhere" }).click();
    await expect(adminPage.getByText(`This signs ${member.email} out on every device.`, { exact: false })).toBeVisible();
    await adminPage.getByRole("button", { name: "Log them out everywhere" }).click();
    await expect(adminPage.getByRole("list", { name: "Admin history" }).getByText(/^Logged out everywhere \(\d+ sessions\)$/)).toBeVisible();

    for (const page of [phone, laptop]) {
      await page.goto("/home");
      await page.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
      await expect(page.getByText("Get started")).toBeVisible();
    }

    // The admin's own session is untouched.
    await adminPage.goto("/admin");
    await expect(adminPage.getByRole("heading", { name: "Admin" })).toBeVisible();

    for (const p of [adminPage, phone, laptop]) await p.context().close();
  });

  test("E27c: a non-admin is redirected away from /admin and can't call the admin RPCs or the force-logout route", async ({ browser }) => {
    const member = await makeMember("c_e27c");
    const other = await makeMember("c_e27c2");
    const page = await signedIn(browser, member.email);

    await page.goto("/admin");
    await page.waitForURL("**/home");
    await page.goto(`/admin/users/${other.id}`);
    await page.waitForURL("**/home");

    const client = await userClientFor(page.context());
    const list = await client.rpc("admin_list_users", {});
    expect(list.error?.code).toBe("42501");
    expect(list.data).toBeNull();
    const suspend = await client.rpc("admin_set_status", { target: other.id, status: "suspended" });
    expect(suspend.error?.code).toBe("42501");

    const res = await page.request.post("/api/admin/force-logout", { data: { target: other.id } });
    expect(res.status()).toBe(403);

    const { data } = await adminClient().from("profiles").select("status").eq("id", other.id).single();
    expect(data?.status).toBe("active");

    // A visitor with no session at all lands on the splash.
    const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const anonPage = await anon.newPage();
    await anonPage.goto("/admin");
    await anonPage.waitForURL((u) => u.pathname === "/");

    await page.context().close();
    await anon.close();
  });
});
