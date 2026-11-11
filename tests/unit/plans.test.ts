import { describe, it, expect } from "vitest";
import { ctaState, parseFrom, pickTier, plansView, PLANS_FROMS, planRowText, ultraFull } from "@/lib/plans";
import { PLAN_CONFIG, TIER_ORDER, type PlanId } from "@/lib/config";
import { freshEntitlement, type Entitlement } from "@/state/schema";

const ent = (over: Partial<Entitlement> = {}): Entitlement => ({ ...freshEntitlement(), ...over });
const trial = (day: number, left = 100) => ent({ plan: "trial", trialDay: day, chatsLeftToday: left });
const paid = (plan: PlanId) => ent({ plan, trialDay: null, chatsLeftToday: null, slotLimit: PLAN_CONFIG.tiers[plan].slots });
const PRICES: Record<PlanId, string> = { pro: "₹299", max: "₹499", ultra: "₹799" };

describe("which tier each entry point pre-selects", () => {
  it("trial, chats, locked and settings open on Pro; newally on Max; deep on Ultra", () => {
    expect(pickTier("trial", trial(4))).toBe("pro");
    expect(pickTier("chats", trial(4))).toBe("pro");
    expect(pickTier("locked", ent({ plan: "expired" }))).toBe("pro");
    expect(pickTier("settings", trial(4))).toBe("pro");
    expect(pickTier("newally", trial(4))).toBe("max");
    expect(pickTier("deep", trial(4))).toBe("ultra");
  });

  it("settings opens on the current plan for a subscriber", () => {
    for (const p of TIER_ORDER) expect(pickTier("settings", paid(p))).toBe(p);
  });

  it("a subscriber is offered the next tier up when the entry point's tier is theirs already", () => {
    expect(pickTier("newally", paid("pro"))).toBe("max");
    expect(pickTier("newally", paid("max"))).toBe("ultra");
    expect(pickTier("deep", paid("max"))).toBe("ultra");
    expect(pickTier("newally", paid("ultra"))).toBe("ultra");
  });
});

describe("plansView", () => {
  it("trial: days left, the day meter, close and Maybe later", () => {
    const v = plansView("trial", trial(4));
    expect(v.head).toBe("3 days left of your free week.");
    expect(v.sub).toBe("Subscribe now and your Ally never has to wait.");
    expect(v.meter).toEqual({ pct: 57, text: "Day 4 of 7, free trial" });
    expect(v).toMatchObject({ showClose: true, later: "maybeLater", pick: "pro" });
    expect(plansView("trial", trial(6)).head).toBe("1 day left of your free week.");
    expect(plansView("trial", trial(7)).head).toBe("Last day of your free week.");
  });

  it("chats: the trial chats left and how much is used", () => {
    const v = plansView("chats", trial(2, 12));
    expect(v.head).toBe("You have 12 chats left today.");
    expect(v.meter).toEqual({ pct: 88, text: "12 of 100 trial chats left today" });
    expect(plansView("chats", trial(2, 1)).head).toBe("You have 1 chat left today.");
    expect(plansView("chats", trial(2, 0)).head).toBe("You are out of chats for today.");
    expect(plansView("chats", trial(2, 0)).meter?.pct).toBe(100);
  });

  it("locked: no close, no meter, Read your chats instead of Maybe later", () => {
    const v = plansView("locked", ent({ plan: "expired" }));
    expect(v).toMatchObject({ head: "Your free week is over.", meter: null, showClose: false, later: "readChats", pick: "pro" });
    expect(v.sub).toBe("Pick a plan to keep talking to your Ally. Your chats are saved.");
  });

  it("newally, deep and settings: close and Maybe later shown, no meter", () => {
    expect(plansView("newally", trial(3))).toMatchObject({ head: "Room for another Ally.", meter: null, showClose: true, later: "maybeLater", pick: "max" });
    expect(plansView("deep", trial(3))).toMatchObject({ head: "There is a deeper level.", meter: null, showClose: true, later: "maybeLater", pick: "ultra" });
    expect(plansView("settings", trial(3))).toMatchObject({ head: "Choose your plan.", meter: null, showClose: true, later: "maybeLater" });
    expect(plansView("settings", paid("max")).head).toBe("Your plan.");
  });

  it("every entry point renders for every plan without an empty line", () => {
    for (const from of PLANS_FROMS) {
      for (const e of [trial(1), trial(7, 1), ent({ plan: "expired" }), paid("pro"), paid("max"), paid("ultra")]) {
        const v = plansView(from, e);
        expect(v.head.length, `${from}/${e.plan}`).toBeGreaterThan(0);
        expect(v.sub.length).toBeGreaterThan(0);
        expect(`${v.head} ${v.sub} ${v.meter?.text ?? ""}`).not.toMatch(/—|undefined|\{/);
      }
    }
  });
});

describe("parseFrom", () => {
  it("accepts the six entry points and falls back to settings", () => {
    for (const f of ["trial", "chats", "locked", "newally", "deep", "settings"]) expect(parseFrom(f)).toBe(f);
    for (const bad of [null, undefined, "", "nope", "TRIAL"]) expect(parseFrom(bad)).toBe("settings");
  });
});

describe("the CTA", () => {
  it("a new subscriber sees Continue with {Tier}, price a month", () => {
    expect(ctaState("pro", trial(3), PRICES, false)).toEqual({ label: "Continue with Pro, ₹299 a month", disabled: false });
    expect(ctaState("ultra", ent({ plan: "expired" }), PRICES, false)).toEqual({ label: "Continue with Ultra, ₹799 a month", disabled: false });
  });

  it("uses the localized price when Play gave one", () => {
    expect(ctaState("max", trial(3), { ...PRICES, max: "₹499.00" }, false).label).toBe("Continue with Max, ₹499.00 a month");
  });

  it("a subscriber sees Current plan (disabled) on their tier and Switch to {Tier} on the others", () => {
    expect(ctaState("max", paid("max"), PRICES, false)).toEqual({ label: "Current plan", disabled: true });
    expect(ctaState("ultra", paid("max"), PRICES, false)).toEqual({ label: "Switch to Ultra", disabled: false });
    expect(ctaState("pro", paid("max"), PRICES, false)).toEqual({ label: "Switch to Pro", disabled: false });
  });

  it("on the web the button sends people to Google Play (but a current plan stays disabled)", () => {
    expect(ctaState("pro", trial(3), PRICES, true)).toEqual({ label: "Get Ally on Google Play", disabled: false });
    expect(ctaState("ultra", paid("max"), PRICES, true).label).toBe("Get Ally on Google Play");
    expect(ctaState("max", paid("max"), PRICES, true).disabled).toBe(true);
  });
});

describe("Ultra with every slot full", () => {
  it("skips the plans screen only for newally", () => {
    expect(ultraFull("newally", paid("ultra"), 4)).toBe(true);
    expect(ultraFull("newally", paid("ultra"), 3)).toBe(false);
    expect(ultraFull("settings", paid("ultra"), 4)).toBe(false);
    expect(ultraFull("newally", paid("max"), 2)).toBe(false);
  });
});

describe("Settings plan row", () => {
  it("shows the plan, the trial days left, or No active plan", () => {
    expect(planRowText(paid("pro"))).toBe("Pro");
    expect(planRowText(paid("ultra"))).toBe("Ultra");
    expect(planRowText(ent({ plan: "expired" }))).toBe("No active plan");
    expect(planRowText(trial(4))).toBe("Free trial, 3 days left");
    expect(planRowText(trial(6))).toBe("Free trial, 1 day left");
    expect(planRowText(trial(7))).toBe("Free trial, last day");
  });
});

describe("plan config", () => {
  it("prices, slots and levels follow the plan table", () => {
    const t = PLAN_CONFIG.tiers;
    expect([t.pro.price, t.max.price, t.ultra.price]).toEqual([299, 499, 799]);
    expect([t.pro.slots, t.max.slots, t.ultra.slots]).toEqual([1, 2, 4]);
    expect([t.pro.maxLevel, t.max.maxLevel, t.ultra.maxLevel]).toEqual([5, 5, 6]);
    expect(PLAN_CONFIG.trial).toEqual({ dailyChats: 100, slots: 1, maxLevel: 5 });
    expect(PLAN_CONFIG.trialDays).toBe(7);
  });
});
