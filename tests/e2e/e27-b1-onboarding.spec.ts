import { test, expect, type Page } from "@playwright/test";
import {
  FIXED_NOW,
  STATE_KEY,
  setClock,
  seedState,
  makeState,
  emptyAnswers,
  driveFirstRunIntro,
  trackHealth,
  assertHealthy,
  screenshotScreen,
} from "./helpers";

// B1: five cores, option cards, the tiebreaker, core-bound decks, the deck
// tutorial and the Constellation.

const ROMANTIC_WOMEN = ["F02", "F03", "F05", "F06", "F10", "F14", "F15", "F16", "F01"];

// ROMANTIC by a wide margin, whatever the pressure.
const ROMANTIC_ANSWERS = { q5: 1, q6: 0, q7: 1, q8: 1, q9: 2, q10: "alone", q11: ["making"] };
// MONEY: 9 points to TRAINER's 6, so no tiebreak.
const MONEY_ANSWERS = { q5: 3, q6: 3, q7: 3, q8: 2, q9: 3, q10: "money", q11: ["making"] };
// MONEY 7 to PSYCH 6: a close call between those two.
const CLOSE_ANSWERS = { q5: 0, q6: 2, q7: 3, q8: 2, q9: 0, q10: "money", q11: ["making"] };

const TIEBREAK_MONEY = "Right. List what's actually urgent. We'll sort the rest tomorrow.";
const TIEBREAK_PSYCH = "Let's slow it down. What's the thought that keeps coming back?";

function flowAt(step: string, over: Record<string, unknown> = {}) {
  const { q5, q6, q7, q8, q9, q10, q11 } = ROMANTIC_ANSWERS;
  return {
    kind: "first",
    step,
    cityRaw: "Mumbai",
    region: "West",
    deckGender: "woman",
    displayName: "Riya",
    dob: "2002-01-01",
    age: 24,
    answers: { ...emptyAnswers(), q5, q6, q7, q8, q9, q10, q11 },
    core: { primary: null, secondary: null, weight: null, ranked: [] },
    deckOrder: [],
    deckIndex: 0,
    deckHistory: [],
    dwell: {},
    liked: [],
    expanded: [],
    poolRemoved: [],
    redraws: 0,
    canRedraw: false,
    proposed: null,
    proposalsSeen: 0,
    proposalMode: null,
    tutorialShown: true,
    ...over,
  };
}

async function seedFlow(page: Page, flow: unknown, opts: { once?: boolean } = {}) {
  await setClock(page, FIXED_NOW);
  await seedState(page, makeState({ flow, user: { accountAt: null, accountContact: null, accountKind: null } }), opts);
}

/** The flow out of whichever namespaced state key this context wrote. */
async function storedFlow(page: Page): Promise<Record<string, any> | null> {
  return page.evaluate((prefix) => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      try {
        const s = JSON.parse(localStorage.getItem(k) as string);
        if (s?.flow) return s.flow;
      } catch {
        /* not ours */
      }
    }
    return null;
  }, `${STATE_KEY}:`);
}

/** Counts AudioContext constructions: the Constellation has no audio, so this must stay 0. */
async function spyOnAudio(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __audioContexts: number };
    w.__audioContexts = 0;
    for (const name of ["AudioContext", "webkitAudioContext"]) {
      const Orig = w[name] as (new (...a: unknown[]) => object) | undefined;
      if (!Orig) continue;
      w[name] = class extends Orig {
        constructor(...a: unknown[]) {
          super(...a);
          w.__audioContexts++;
        }
      };
    }
  });
}
const audioContexts = (page: Page) => page.evaluate(() => (window as unknown as { __audioContexts: number }).__audioContexts);

/** A flow parked on the Constellation with three liked faces (ring of three). */
function choosingFlow(over: Record<string, unknown> = {}) {
  return flowAt("choosing", { deckOrder: ["F02", "F03", "F05"], liked: ["F02", "F03", "F05"], dwell: { F02: 5000, F03: 3000, F05: 1000 }, ...over });
}

const NEVER = () => {
  /* a request that is never answered */
};

test.describe("E27 B1: five cores and onboarding motion", () => {
  test("E27.1: the rivers carry no Woman/Man text, and the tap by aria-label still commits", async ({ page }) => {
    await setClock(page, FIXED_NOW);
    const health = trackHealth(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Get started" }).click();
    await page.waitForURL("**/onboarding/consent");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Mumbai", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/onboarding/gender");
    await expect(page.getByRole("button", { name: "A woman" })).toBeVisible();
    await page.waitForTimeout(3000);

    await expect(page.locator("body")).not.toContainText(/\b(woman|man)\b/i);
    await screenshotScreen(page, "e27-01-rivers");

    await page.getByRole("button", { name: "A woman" }).click();
    await page.waitForURL("**/onboarding/name");
    expect((await storedFlow(page))?.deckGender).toBe("woman");
    assertHealthy(health);
  });

  test("E27.2: Q5 to Q9 are option cards that advance by themselves, with no slider", async ({ page }) => {
    await setClock(page, FIXED_NOW);
    const health = trackHealth(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Get started" }).click();
    await page.waitForURL("**/onboarding/consent");
    await driveFirstRunIntro(page);

    await page.waitForURL("**/onboarding/questions/disclosure");
    await expect(page.getByRole("radiogroup")).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(4);
    await expect(page.getByRole("slider")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);

    // A tap selects, then moves on by itself.
    await page.getByRole("radio", { name: "I tell one person" }).click();
    await expect(page.getByRole("radio", { name: "I tell one person" })).toHaveAttribute("aria-checked", "true");
    await screenshotScreen(page, "e27-02-cards");
    await page.waitForURL("**/onboarding/questions/warmth");

    for (const [route, option] of [
      ["push", "Feeling understood"],
      ["structure", "Someone who believes in me"],
      ["offday", "Loosely sketched"],
      ["pressure", "Someone to just stay"],
    ] as const) {
      await expect(page.getByRole("slider")).toHaveCount(0);
      await page.getByRole("radio", { name: option }).click();
      await page.waitForURL(`**/onboarding/questions/${route}`);
    }
    // Q10 keeps its dial.
    await expect(page.getByRole("slider")).toHaveCount(1);
    const flow = await storedFlow(page);
    expect([flow?.answers.q5, flow?.answers.q6, flow?.answers.q7, flow?.answers.q8, flow?.answers.q9]).toEqual([1, 0, 1, 1, 2]);
    assertHealthy(health);
  });

  test("E27.2b: keyboard operation of the cards: arrows move focus, Enter selects", async ({ page }) => {
    await seedFlow(page, flowAt("questions/disclosure", { answers: emptyAnswers() }));
    await page.goto("/onboarding/questions/disclosure");
    await page.getByRole("radio").first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio").nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/onboarding/questions/warmth");
    expect((await storedFlow(page))?.answers.q5).toBe(2);
  });

  test("E27.3: a close call goes through the tiebreaker to matching", async ({ page }) => {
    const health = trackHealth(page);
    await seedFlow(page, flowAt("questions/interests", { answers: { ...emptyAnswers(), ...CLOSE_ANSWERS } }));
    await page.goto("/onboarding/questions/interests");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.waitForURL("**/onboarding/questions/tiebreak");
    await expect(page.getByText("It's 11pm and it's been a rough day. Which message would you rather get?")).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(2);
    await expect(page.getByRole("radio", { name: TIEBREAK_MONEY })).toBeVisible();
    await expect(page.getByRole("radio", { name: TIEBREAK_PSYCH })).toBeVisible();
    // Not one of the Q5-Q11 pips.
    await expect(page.locator('[class*="rule"]')).toHaveCount(0);
    await screenshotScreen(page, "e27-03-tiebreak");

    await page.getByRole("radio", { name: TIEBREAK_PSYCH }).click();
    await page.waitForURL("**/onboarding/matching");
    expect((await storedFlow(page))?.answers.tb).toBe("PSYCH");

    // Back from matching returns to the tiebreak, since one was played.
    await page.getByRole("button", { name: "Back" }).click();
    await page.waitForURL("**/onboarding/questions/tiebreak");
    assertHealthy(health);
  });

  test("E27.3b: a clear answer set skips the tiebreaker", async ({ page }) => {
    await seedFlow(page, flowAt("questions/interests"));
    await page.goto("/onboarding/questions/interests");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/onboarding/matching");
    await page.getByRole("button", { name: "Back" }).click();
    await page.waitForURL("**/onboarding/questions/interests");
  });

  test("E27.4: the first deck plays the tutorial: input locked, Skip ends it, ? replays it", async ({ page }) => {
    const health = trackHealth(page);
    await seedFlow(page, flowAt("deck", { deckOrder: ROMANTIC_WOMEN, tutorialShown: false }));
    await page.goto("/onboarding/deck");
    await expect(page.getByText(`1 of ${ROMANTIC_WOMEN.length}`)).toBeVisible();

    // The tutorial is running: keys and the ? are dead.
    await expect(page.getByText("Swipe right to keep")).toBeVisible({ timeout: 3000 });
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(`1 of ${ROMANTIC_WOMEN.length}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Show how this works" })).toBeDisabled();
    await page.waitForTimeout(1000);
    await screenshotScreen(page, "e27-04-tutorial-right");

    // Skip has appeared by now.
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(0);
    await expect.poll(async () => (await storedFlow(page))?.tutorialShown).toBe(true);
    // Dwell did not run during the tutorial.
    expect((await storedFlow(page))?.dwell?.[ROMANTIC_WOMEN[0]] ?? 0).toBeLessThan(1500);

    // Input works again.
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(`2 of ${ROMANTIC_WOMEN.length}`)).toBeVisible();

    // The ? replays it on demand.
    await page.getByRole("button", { name: "Show how this works" }).click();
    await expect(page.getByText("Swipe right to keep")).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("Swipe left to pass")).toBeVisible({ timeout: 5000 });
    assertHealthy(health);
  });

  test("E27.4b: the tutorial plays once: a state that already showed it starts with input live", async ({ page }) => {
    await seedFlow(page, flowAt("deck", { deckOrder: ROMANTIC_WOMEN, tutorialShown: true }));
    await page.goto("/onboarding/deck");
    await expect(page.getByText(`1 of ${ROMANTIC_WOMEN.length}`)).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByText("Swipe right to keep")).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(`2 of ${ROMANTIC_WOMEN.length}`)).toBeVisible();
  });

  test("E27.4c: reduced motion shows a static overlay with a Got it button", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedFlow(page, flowAt("deck", { deckOrder: ROMANTIC_WOMEN, tutorialShown: false }));
    await page.goto("/onboarding/deck");
    await expect(page.getByText("Swipe right to keep")).toBeVisible();
    await expect(page.getByText("Swipe left to pass")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(`1 of ${ROMANTIC_WOMEN.length}`)).toBeVisible();
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.getByText("Swipe right to keep")).toHaveCount(0);
    await expect.poll(async () => (await storedFlow(page))?.tutorialShown).toBe(true);
  });

  test("E27.5: finishing the deck plays the Constellation and lands on the proposal; a redraw plays the short one", async ({ page }) => {
    const health = trackHealth(page);
    await spyOnAudio(page);
    const deck = ["F02", "F03", "F05"];
    await seedFlow(page, flowAt("deck", { deckOrder: deck, tutorialShown: true }));
    await page.goto("/onboarding/deck");
    await expect(page.getByText("1 of 3")).toBeVisible();

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(120);
    }
    await page.waitForURL("**/onboarding/choosing");
    await expect(page.getByRole("status", { name: "Choosing someone for you" })).toBeVisible();
    await page.waitForTimeout(2000);
    await screenshotScreen(page, "e27-05-constellation");
    await page.waitForURL("**/onboarding/proposal", { timeout: 10000 });
    expect((await storedFlow(page))?.proposed).toBeTruthy();

    // Three likes: a redraw is offered. It goes back through the short version.
    const first = (await storedFlow(page))?.proposed;
    await page.getByRole("button", { name: "Show me someone else" }).click();
    await page.waitForURL("**/onboarding/choosing?short=1");
    await expect(page.getByRole("status", { name: "Choosing someone for you" })).toBeVisible();
    await page.waitForURL("**/onboarding/proposal", { timeout: 6000 });
    expect((await storedFlow(page))?.proposed).not.toBe(first);
    // No audio anywhere in the Constellation: no AudioContext was ever created.
    expect(await audioContexts(page)).toBe(0);
    assertHealthy(health);
  });

  test("E27.5b: reduced motion routes through the Constellation without movement", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedFlow(page, flowAt("choosing", { deckOrder: ["F02", "F03"], liked: ["F02", "F03"], dwell: { F02: 5000, F03: 1000 } }));
    await page.goto("/onboarding/choosing");
    await expect(page.getByRole("status", { name: "Choosing someone for you" })).toBeVisible();
    await page.waitForURL("**/onboarding/proposal", { timeout: 5000 });
  });

  test("E27.6: a ROMANTIC woman deck contains F01, a MONEY one does not", async ({ page }) => {
    const health = trackHealth(page);
    await seedFlow(page, flowAt("matching", { answers: { ...emptyAnswers(), ...ROMANTIC_ANSWERS } }));
    await page.goto("/onboarding/matching");
    await page.waitForTimeout(2700);
    await page.getByRole("button", { name: "Show me" }).click();
    await page.waitForURL("**/onboarding/deck");
    const romantic = (await storedFlow(page))?.deckOrder as string[];
    expect(romantic).toContain("F01");
    expect([...romantic].sort()).toEqual([...ROMANTIC_WOMEN].sort());

    // A fresh context for the MONEY answers.
    const money = await page.context().browser()!.newContext({ viewport: { width: 390, height: 844 } });
    const page2 = await money.newPage();
    await seedFlow(page2, flowAt("matching", { answers: { ...emptyAnswers(), ...MONEY_ANSWERS } }));
    await page2.goto("/onboarding/matching");
    await page2.waitForTimeout(2700);
    await page2.getByRole("button", { name: "Show me" }).click();
    await page2.waitForURL("**/onboarding/deck");
    const moneyDeck = (await storedFlow(page2))?.deckOrder as string[];
    expect(moneyDeck).not.toContain("F01");
    expect([...moneyDeck].sort()).toEqual(["F11", "F13", "F16"]);
    await money.close();
    assertHealthy(health);
  });

  test("E27.7: changing an earlier answer clears the tiebreak and the deck", async ({ page }) => {
    await seedFlow(
      page,
      flowAt("questions/structure", {
        answers: { ...emptyAnswers(), ...CLOSE_ANSWERS, tb: "PSYCH" },
        core: { primary: "PSYCH", secondary: null, weight: 100, ranked: [{ id: "PSYCH", score: 9 }] },
        deckOrder: ["F04", "F07"],
        liked: ["F04"],
      })
    );
    await page.goto("/onboarding/questions/structure");
    await page.getByRole("radio", { name: "Mostly planned" }).click(); // was index 2 ("Mostly planned")
    // Same answer: nothing changes.
    await page.waitForURL("**/onboarding/questions/offday");
    expect((await storedFlow(page))?.answers.tb).toBe("PSYCH");

    await page.getByRole("button", { name: "Back" }).click();
    await page.waitForURL("**/onboarding/questions/structure");
    await page.getByRole("radio", { name: "Open, I'll see what happens" }).click();
    await expect(page.getByText("That changed who you'd meet. Starting the deck again.")).toBeVisible();
    await page.waitForURL("**/onboarding/questions/offday");
    const flow = await storedFlow(page);
    expect(flow?.answers.tb).toBeNull();
    expect(flow?.deckOrder).toEqual([]);
    expect(flow?.core.primary).toBeNull();
  });

  test("E27.8: with every CSS transition and animation disabled it still routes within 6.5 s", async ({ page }) => {
    await page.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
      document.documentElement.appendChild(style);
    });
    await seedFlow(page, choosingFlow());
    const t0 = Date.now();
    await page.goto("/onboarding/choosing");
    await page.waitForURL("**/onboarding/proposal", { timeout: 6500 });
    expect(Date.now() - t0).toBeLessThan(6500);
    await expect(page.getByRole("button", { name: "Lock them in" })).toBeVisible();
  });

  test("E27.9: an extra state update in the middle of the animation does not stop the route", async ({ page }) => {
    await spyOnAudio(page);
    await seedFlow(page, choosingFlow());
    await page.goto("/onboarding/choosing");
    await expect(page.getByRole("status", { name: "Choosing someone for you" })).toBeVisible();
    await page.waitForTimeout(1200);

    // The debug panel's "Start pass" goes through the server and dispatches
    // BUY_PASS: a provider-wide state change while the Constellation plays.
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(20, 20);
      await page.waitForTimeout(80);
    }
    await page.getByRole("button", { name: "Start pass" }).click();
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Clock +1 day (display only)" }).click(); // and one that touches no state
    await page.getByRole("button", { name: "Close debug panel" }).click();
    expect(new URL(page.url()).pathname).toBe("/onboarding/choosing");

    await page.waitForURL("**/onboarding/proposal", { timeout: 6500 });
    expect(await audioContexts(page)).toBe(0);
  });

  test("E27.10: a stalled proposal request cannot strand the flood: the failsafe leaves by a hard navigation", async ({ page }) => {
    // The root cause of the stuck route: router.replace() is a client-side
    // navigation that waits for the proposal's RSC payload. If that request
    // never answers, nothing ever times it out.
    await page.route(/\/onboarding\/proposal\?_rsc/, NEVER);
    // Seeded once: the hard navigation must see the flow the app persisted, as a real reload does.
    await seedFlow(page, choosingFlow(), { once: true });
    const t0 = Date.now();
    await page.goto("/onboarding/choosing");
    await expect(page.getByRole("status", { name: "Choosing someone for you" })).toBeVisible();
    // Still stuck after the natural end (about 4.2 s, plus the preload allowance)...
    await page.waitForTimeout(5300);
    expect(new URL(page.url()).pathname).toBe("/onboarding/choosing");
    // ...and out by the 6 s failsafe.
    await page.waitForURL("**/onboarding/proposal", { timeout: 2500 });
    expect(Date.now() - t0).toBeLessThan(8500);
    await expect(page.getByRole("button", { name: "Lock them in" })).toBeVisible();
    expect((await storedFlow(page))?.proposed).toBeTruthy();
  });

  test("E27.10b: the short variant has a 2.5 s failsafe", async ({ page }) => {
    await page.route(/\/onboarding\/proposal\?_rsc/, NEVER);
    await seedFlow(page, choosingFlow({ redraws: 1, poolRemoved: ["F02"], proposed: "F02" }), { once: true });
    const t0 = Date.now();
    await page.goto("/onboarding/choosing?short=1");
    await page.waitForURL("**/onboarding/proposal", { timeout: 5000 });
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  test("E27.11: the winner's avatar is visible, in front of the flood, at about 3.5 s", async ({ page }) => {
    await seedFlow(page, choosingFlow());
    await page.goto("/onboarding/choosing");
    await expect(page.getByRole("status", { name: "Choosing someone for you" })).toBeVisible();
    await page.waitForTimeout(3500);

    const hero = page.locator("[data-hero]");
    const img = hero.locator("img");
    await expect(img).toBeVisible();
    const probe = await hero.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const im = el.querySelector("img") as HTMLImageElement;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        opacity: parseFloat(getComputedStyle(el).opacity),
        naturalWidth: im.naturalWidth,
        width: r.width,
        inFront: !!top && el.contains(top), // not covered by the flood
      };
    });
    expect(probe.opacity).toBe(1);
    expect(probe.naturalWidth).toBeGreaterThan(0); // the image really loaded
    expect(probe.width).toBeGreaterThan(100); // grown towards 160
    expect(probe.inFront).toBe(true);
    await screenshotScreen(page, "e27-06-winner-at-3500");

    // Once the flood is actually covering the centre, the winner is still the
    // topmost thing there: the flood is the winner's own colour, so behind it
    // the circle would look empty.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector("[class*=flood]") as Element).clipPath), { timeout: 3000 })
      .not.toBe("circle(0px at 50% 50%)");
    const covered = await hero.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { inFront: !!top && el.contains(top), naturalWidth: (el.querySelector("img") as HTMLImageElement).naturalWidth };
    });
    expect(covered).toEqual({ inFront: true, naturalWidth: expect.any(Number) });
    expect(covered.naturalWidth).toBeGreaterThan(0);
    await page.waitForURL("**/onboarding/proposal", { timeout: 6500 });
  });

  test("E27.11b: an avatar that fails to load shows the face's first initial on its palette colour", async ({ page }) => {
    await page.route("**/assets/avatars/*", (route) => route.abort());
    await seedFlow(page, choosingFlow());
    await page.goto("/onboarding/choosing");
    await expect(page.getByRole("status", { name: "Choosing someone for you" })).toBeVisible();
    await page.waitForTimeout(3500);

    const winnerId = (await storedFlow(page))?.proposed as string;
    const manifest = (await (await page.request.get("/assets/manifest.json")).json()) as { templates: { id: string; name: string; palette: string }[] };
    const winner = manifest.templates.find((t) => t.id === winnerId)!;
    const initial = winner.name.charAt(0).toUpperCase();

    const hero = page.locator("[data-hero]");
    await expect(hero.locator("img")).toHaveCount(0);
    await expect(hero).toContainText(initial);
    await expect(hero).toBeVisible();
    // Never an empty circle: every ring face that has faded in shows its initial too.
    await screenshotScreen(page, "e27-07-avatar-fallback");
    await page.waitForURL("**/onboarding/proposal", { timeout: 6500 });
  });
});
