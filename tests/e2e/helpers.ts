import { BrowserContext, Page, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export const STATE_KEY = "ally_v2";

/** Fixed instant used across the suite unless a test needs otherwise:
 * 2026-01-15 15:30 IST (daytime), for deterministic presence lines / day keys. */
export const FIXED_NOW = Date.UTC(2026, 0, 15, 10, 0, 0);

export function dayKeyIST(ms: number): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(ms));
}

// ---- state shape helpers (mirrors src/state/schema.ts) ----

export function emptyAnswers() {
  return { q5: null, q6: null, q7: null, q8: null, q9: null, q10: null, q11: [] as string[] };
}

export function defaultCore() {
  return {
    primary: "MEHER",
    secondary: null,
    weight: 100,
    ranked: [
      { id: "MEHER", score: 0.9 },
      { id: "KIAAN", score: 0.5 },
      { id: "ANANYA", score: 0.4 },
      { id: "VEER", score: 0.3 },
      { id: "PRIYA", score: 0.2 },
      { id: "ANAY", score: 0.1 },
    ],
  };
}

export interface MakeCompanionOpts {
  id: string;
  templateId: string;
  deckGender: "woman" | "man";
  createdAt: number;
  lastOpenedAt?: number;
  status?: "active" | "parted";
  partedAt?: number | null;
  purgeAt?: number | null;
  messages?: { who: "them" | "me"; text: string; at: number }[];
  exchanges?: number;
  unread?: number;
  notify?: boolean;
  sound?: boolean;
}

export function makeCompanion(o: MakeCompanionOpts) {
  return {
    id: o.id,
    templateId: o.templateId,
    deckGender: o.deckGender,
    answers: emptyAnswers(),
    core: defaultCore(),
    createdAt: o.createdAt,
    lastOpenedAt: o.lastOpenedAt ?? o.createdAt,
    status: o.status ?? "active",
    partedAt: o.partedAt ?? null,
    purgeAt: o.purgeAt ?? null,
    messages: o.messages ?? [{ who: "them", text: "Hey.", at: o.createdAt }],
    exchanges: o.exchanges ?? 0,
    unread: o.unread ?? 0,
    notify: o.notify ?? true,
    sound: o.sound ?? true,
  };
}

export interface MakeStateOpts {
  companions?: ReturnType<typeof makeCompanion>[];
  ledger?: Record<string, unknown>;
  user?: Record<string, unknown>;
  flow?: unknown;
  now?: number;
}

export function makeState(opts: MakeStateOpts = {}) {
  const now = opts.now ?? FIXED_NOW;
  const day = dayKeyIST(now);
  return {
    v: 2,
    savedAt: now,
    user: {
      displayName: "Riya",
      consentAt: now,
      consentMarketing: false,
      accountAt: now,
      accountContact: "riya@example.com",
      accountKind: "email",
      accountDismissed: 0,
      soundOn: true,
      unmuted: false,
      ...(opts.user ?? {}),
    },
    companions: opts.companions ?? [],
    ledger: {
      slotsUnlocked: 1,
      unlocks: [],
      parted: [],
      day,
      freeUsed: 0,
      pass: null,
      passes: [],
      ...(opts.ledger ?? {}),
    },
    flow: opts.flow ?? null,
  };
}

/** P1: state is namespaced per Supabase user. */
export function stateKeyFor(uid: string) {
  return `${STATE_KEY}:${uid}`;
}

/**
 * Bootstraps a real anonymous Supabase session for this browser context via
 * the E2E-only route (it sets the session cookies) and returns the user id.
 */
export async function createTestSession(page: Page): Promise<string> {
  const res = await page.request.get("/api/test/session");
  expect(res.ok(), `/api/test/session failed: ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { userId: string };
  return body.userId;
}

type SeedState = ReturnType<typeof makeState>;

async function must<T extends { error: { message: string } | null }>(label: string, p: PromiseLike<T>): Promise<T> {
  const res = await p;
  if (res.error) throw new Error(`seed ${label}: ${res.error.message}`);
  return res;
}

/**
 * P2: companions, messages and the ledger are server-owned, so a seeded
 * state's server part is written to the six tables with the service-role
 * client (the only way to set arbitrary ledger values; clients have no
 * write grants). Timestamps are shifted from the test's clock frame
 * (`state.savedAt`, normally FIXED_NOW) into real time, because the server
 * judges day rollover, pass expiry and purge dates with its own now(): a
 * pass that "ends in 20h" or a purge "29 days out" stays exactly that far
 * from the server's clock. A ledger day equal to the seed's "today" maps to
 * the real IST today.
 */
export async function seedServerState(userId: string, state: SeedState): Promise<void> {
  const admin = adminClient();
  const shift = Date.now() - state.savedAt;
  const ts = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : new Date(ms + shift).toISOString());
  const ledger = state.ledger as unknown as {
    slotsUnlocked: number;
    day: string;
    freeUsed: number;
    pass: { startedAt: number; endsAt: number; used: number } | null;
    unlocks: { slot: number; at: number; amount: number }[];
    passes: { startedAt: number; amount: number }[];
    parted: string[];
  };

  if (state.user.displayName) {
    await must("profile", admin.from("profiles").update({ display_name: state.user.displayName }).eq("id", userId));
  }

  // Companion ids are global primary keys and specs use fixed ids, so clear
  // any row a previous run of the same spec left behind.
  const ids = state.companions.map((c) => c.id);
  if (ids.length) await must("clear companions", admin.from("companions").delete().in("id", ids));
  for (const c of state.companions) {
    await must(
      "companion",
      admin.from("companions").insert({
        id: c.id,
        user_id: userId,
        template_id: c.templateId,
        deck_gender: c.deckGender,
        answers: c.answers,
        core: c.core,
        created_at: ts(c.createdAt),
        last_opened_at: ts(c.lastOpenedAt),
        status: c.status,
        parted_at: ts(c.partedAt),
        purge_at: ts(c.purgeAt),
        exchanges: c.exchanges,
        unread: c.unread,
        notify: c.notify,
        sound: c.sound,
      })
    );
    if (c.messages.length) {
      await must(
        "messages",
        admin.from("messages").insert(c.messages.map((m) => ({ companion_id: c.id, user_id: userId, who: m.who, text: m.text, created_at: ts(m.at) })))
      );
    }
  }

  const day = ledger.day === dayKeyIST(state.savedAt) ? dayKeyIST(Date.now()) : ledger.day;
  await must(
    "ledger",
    admin.from("ledgers").upsert({
      user_id: userId,
      slots_unlocked: ledger.slotsUnlocked,
      day,
      free_used: ledger.freeUsed,
      pass_started_at: ts(ledger.pass?.startedAt),
      pass_ends_at: ts(ledger.pass?.endsAt),
      pass_used: ledger.pass ? ledger.pass.used : null,
    })
  );
  if (ledger.unlocks.length) {
    await must("unlocks", admin.from("ledger_unlocks").insert(ledger.unlocks.map((u) => ({ user_id: userId, slot: u.slot, at: ts(u.at), amount: u.amount }))));
  }
  if (ledger.passes.length) {
    await must("passes", admin.from("ledger_passes").insert(ledger.passes.map((p) => ({ user_id: userId, started_at: ts(p.startedAt), amount: p.amount }))));
  }
  if (ledger.parted.length) {
    await must("parted", admin.from("ledger_parted").insert(ledger.parted.map((t) => ({ user_id: userId, template_id: t }))));
  }
}

/**
 * Creates an anonymous session, writes the state's companions/messages/
 * ledger to the server (seedServerState), then seeds the local part (flow
 * and user) into localStorage['ally_v2:<userId>'] before any app script
 * runs. Returns the user id.
 */
export async function seedState(page: Page, state: SeedState): Promise<string> {
  const userId = await createTestSession(page);
  await seedServerState(userId, state);
  const local = { ...state, companions: [], ledger: { ...state.ledger, unlocks: [], parted: [], passes: [], pass: null, freeUsed: 0, slotsUnlocked: 1 } };
  await page.addInitScript(
    ({ key, json }) => {
      try {
        window.localStorage.setItem(key, json);
      } catch {
        /* ignore */
      }
    },
    { key: stateKeyFor(userId), json: JSON.stringify(local) }
  );
  return userId;
}

/** Wires window.__allyClock to a fixed ms value before app scripts run. */
export async function setClock(page: Page, ms: number) {
  await page.addInitScript((ms) => {
    (window as unknown as { __allyClock: () => number }).__allyClock = () => ms as number;
  }, ms);
}

// ---- page health (E14) ----

export interface Health {
  errors: string[];
  failed: string[];
}

/** Attach console-error / pageerror / requestfailed listeners. Call before navigating. */
export function trackHealth(page: Page): Health {
  const h: Health = { errors: [], failed: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") h.errors.push(msg.text());
  });
  page.on("pageerror", (err) => h.errors.push(String(err)));
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com")) return;
    const errorText = req.failure()?.errorText ?? "";
    // Next.js cancels in-flight RSC prefetch requests when navigation moves
    // on (e.g. a route change fires while a background prefetch is still in
    // flight) — that's normal SPA behaviour, not a network failure.
    if (errorText === "net::ERR_ABORTED") return;
    h.failed.push(`${url} :: ${errorText}`);
  });
  return h;
}

export function assertHealthy(h: Health) {
  expect(h.errors, `console/page errors: ${JSON.stringify(h.errors)}`).toEqual([]);
  expect(h.failed, `failed requests: ${JSON.stringify(h.failed)}`).toEqual([]);
}

// ---- E13: no rendered text below 15.5px ----

export async function assertMinFontSize(page: Page, minPx = 15.5) {
  const bad = await page.$$eval(
    "*",
    (els, min) => {
      const results: string[] = [];
      for (const el of els) {
        if (el.children.length > 0) continue; // leaf-ish nodes only
        const text = (el.textContent || "").trim();
        if (!text) continue;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity || "1") === 0)
          continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const size = parseFloat(style.fontSize);
        if (size < (min as number)) {
          results.push(`${el.tagName}.${(el.className || "").toString().slice(0, 40)}: ${size}px "${text.slice(0, 30)}"`);
        }
      }
      return results;
    },
    minPx
  );
  expect(bad, `Elements below ${minPx}px: ${JSON.stringify(bad, null, 2)}`).toEqual([]);
}

// ---- E14: no spinner ----

export async function assertNoSpinner(page: Page) {
  const count = await page.$$eval("*", (els) => {
    let n = 0;
    for (const el of els) {
      const cls = (el.className || "").toString().toLowerCase();
      const role = el.getAttribute && el.getAttribute("role");
      if (role === "progressbar") n++;
      else if (/\bspinner\b|\bloading\b|\bloader\b/.test(cls)) {
        const style = window.getComputedStyle(el);
        if (style.display !== "none" && style.visibility !== "hidden") n++;
      }
    }
    return n;
  });
  expect(count, "found spinner/loading indicator elements").toBe(0);
}

// ---- Screenshot helper (E12) ----

export async function screenshotScreen(page: Page, name: string) {
  await page.screenshot({ path: `tests/e2e/__screens__/${name}.png` });
}

/** Presses Tab repeatedly (keyboard-only navigation) until the focused
 * element matches `matcher`, or throws after `maxTabs`. */
export async function tabUntil(
  page: Page,
  matcher: (el: { tag: string; text: string; aria: string }) => boolean,
  maxTabs = 25
) {
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      return { tag: el.tagName, text: (el.textContent || "").trim(), aria: el.getAttribute("aria-label") || "" };
    });
    if (info && matcher(info)) return;
  }
  throw new Error("tabUntil: matcher never satisfied within maxTabs");
}

// ---- Onboarding flow drivers (used by E1/E3/E4/E11) ----

const COPY = {
  consentAction: "Continue",
  genderWoman: "A woman",
  genderMan: "A man",
  q5stops: ["I keep it to myself", "I tell one person", "I need to say it out loud", "Everyone hears about it"],
  q8stops: ["Open, I'll see what happens", "Loosely sketched", "Mostly planned", "Every hour accounted for"],
  matchingAction: "Show me",
  deckDone: "Done",
  proposalPrimary: "Lock them in",
  confirmPrimary: "Yes, it's them",
};

/** Drives consent -> location -> gender -> name -> birthday (first-run only). */
export async function driveFirstRunIntro(page: Page, { name = "Riya", city = "Mumbai", gender = "woman" as "woman" | "man" } = {}) {
  // consent
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: COPY.consentAction }).click();
  // location
  await page.getByRole("button", { name: city, exact: true }).click();
  await page.getByRole("button", { name: COPY.consentAction }).click();
  // gender
  await page.getByRole("button", { name: gender === "woman" ? COPY.genderWoman : COPY.genderMan }).click();
  await page.waitForURL("**/onboarding/name");
  // name
  await page.getByLabel("What should I call you?").fill(name);
  await page.getByRole("button", { name: COPY.consentAction }).click();
  // birthday - defaults (2002) are fine, just continue
  await page.waitForURL("**/onboarding/birthday");
  await page.getByRole("button", { name: COPY.consentAction }).click();
}

/** Drives the 7 question screens, shared by first-run and round-two. */
export async function answerSevenQuestions(page: Page) {
  await page.waitForURL("**/onboarding/questions/disclosure");
  await page.getByText(COPY.q5stops[1], { exact: true }).click();
  await page.getByRole("button", { name: COPY.consentAction }).click();

  await page.waitForURL("**/onboarding/questions/warmth");
  await page.getByRole("slider").focus();
  await page.getByRole("slider").press("ArrowDown");
  await page.getByRole("button", { name: COPY.consentAction }).click();

  await page.waitForURL("**/onboarding/questions/push");
  await page.getByRole("slider").focus();
  await page.getByRole("slider").press("ArrowDown");
  await page.getByRole("button", { name: COPY.consentAction }).click();

  await page.waitForURL("**/onboarding/questions/structure");
  await page.getByText(COPY.q8stops[1], { exact: true }).click();
  await page.getByRole("button", { name: COPY.consentAction }).click();

  await page.waitForURL("**/onboarding/questions/nostalgia");
  await page.getByRole("slider").focus();
  await page.getByRole("slider").press("ArrowDown");
  await page.getByRole("button", { name: COPY.consentAction }).click();

  await page.waitForURL("**/onboarding/questions/pressure");
  await page.getByRole("slider").focus();
  await page.getByRole("slider").press("ArrowRight");
  await page.getByRole("button", { name: COPY.consentAction }).click();

  await page.waitForURL("**/onboarding/questions/interests");
  const tiles = page.locator("button[aria-pressed]");
  await tiles.nth(0).click();
  await tiles.nth(1).click();
  await page.getByRole("button", { name: COPY.consentAction }).click();
}

/** Drives matching -> deck -> choosing -> proposal -> confirm -> reveal -> lands on /chat/[id]. */
export async function driveMatchingThroughChat(page: Page, { reducedMotion = false } = {}) {
  await page.waitForURL("**/onboarding/matching");
  await page.waitForTimeout(2700);
  await page.getByRole("button", { name: COPY.matchingAction }).click();

  await page.waitForURL("**/onboarding/deck");
  // a couple of likes, then Done (visible once 4 swipes happened per spec;
  // use ArrowRight to like without needing pointer drags)
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
  }
  await page.getByRole("button", { name: COPY.deckDone }).click({ timeout: 10000 });

  await page.waitForURL("**/onboarding/proposal");
  await page.getByRole("button", { name: COPY.proposalPrimary }).click();

  await page.getByRole("button", { name: COPY.confirmPrimary }).click();
  await page.waitForURL("**/onboarding/reveal");
  if (reducedMotion) await page.waitForTimeout(1700);
  await page.locator('[role="button"][aria-label="Continue"]').click();

  await page.waitForURL(/\/chat\//, { timeout: 15000 });
}

// ---- P1 auth helpers ----

export function uniqueEmail(): string {
  return `e2e+${randomUUID()}@redream.in`;
}

/** Service-role client for arranging and asserting server state. Test process only. */
export function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Creates a confirmed user (optionally with a password) without sending any mail. */
export async function createUser(email: string, password?: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  return data.user.id;
}

/** Types a 6-digit code into the CodeInput on screen. */
export async function fillCode(page: Page, code: string) {
  await page.getByLabel("6-digit code, digit 1").click();
  await page.keyboard.type(code);
}

/** Password login through the real /login screen. Lands on /home for a user with no companions. */
export async function loginWithPassword(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use password instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

// ---- P2 server-state helpers ----

/** The server-side rows for one user, read with the service-role client. */
export async function serverSnapshot(userId: string) {
  const admin = adminClient();
  const [companions, messages, ledger, parted, passes, unlocks] = await Promise.all([
    admin.from("companions").select("*").eq("user_id", userId).order("created_at"),
    admin.from("messages").select("*").eq("user_id", userId).order("id"),
    admin.from("ledgers").select("*").eq("user_id", userId).maybeSingle(),
    admin.from("ledger_parted").select("template_id").eq("user_id", userId),
    admin.from("ledger_passes").select("*").eq("user_id", userId),
    admin.from("ledger_unlocks").select("*").eq("user_id", userId),
  ]);
  return {
    companions: (companions.data ?? []) as Record<string, unknown>[],
    messages: (messages.data ?? []) as { companion_id: string; who: string; text: string }[],
    ledger: ledger.data as Record<string, unknown> | null,
    parted: (parted.data ?? []).map((r) => r.template_id as string),
    passes: passes.data ?? [],
    unlocks: unlocks.data ?? [],
  };
}

/** The access token of a browser context's Supabase session, from its (possibly chunked) cookie. */
export async function accessTokenFromCookies(context: BrowserContext): Promise<string> {
  const cookies = (await context.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name));
  cookies.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let raw = cookies.map((c) => c.value).join("");
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8");
  const session = JSON.parse(raw) as { access_token: string };
  return session.access_token;
}

/** A Supabase client acting as the browser context's signed-in user, for calling RPCs directly. */
export async function userClientFor(context: BrowserContext) {
  const token = await accessTokenFromCookies(context);
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
