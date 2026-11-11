import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAY_STORE_URL } from "@/lib/config";
import {
  handlePurchaseResult,
  installPurchaseResultHook,
  isWebPurchaseFlow,
  loadPrices,
  restorePurchases,
  startSubscription,
  tierProduct,
  type PurchaseHandlers,
} from "@/lib/billing";

// The unit environment is node, so window is a stub per test.
type FakeWindow = Record<string, unknown>;
function useWindow(w: FakeWindow) {
  vi.stubGlobal("window", w);
  return w;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("startSubscription: the three branches", () => {
  it("1. calls window.AllyBilling.launch(productId, basePlanId) when the Android shell provides it", () => {
    const launch = vi.fn();
    const open = vi.fn();
    useWindow({ AllyBilling: { launch }, open });
    expect(startSubscription("pro")).toBe("launched");
    expect(launch).toHaveBeenCalledWith("ally_pro", "monthly");
    startSubscription("max");
    expect(launch).toHaveBeenLastCalledWith("ally_max", "monthly");
    startSubscription("ultra");
    expect(launch).toHaveBeenLastCalledWith("ally_ultra", "monthly");
    expect(open).not.toHaveBeenCalled();
  });

  it("2. in a browser, opens the Play Store listing in a new tab", () => {
    const open = vi.fn();
    useWindow({ open });
    expect(startSubscription("max")).toBe("opened_store");
    expect(open).toHaveBeenCalledWith(PLAY_STORE_URL, "_blank", "noopener,noreferrer");
    expect(PLAY_STORE_URL).toBe("https://play.google.com/store/apps/details?id=in.redream.ally");
  });

  it("3. inside the Android app with no billing bridge yet, does nothing", () => {
    const open = vi.fn();
    useWindow({ open, Capacitor: { isNativePlatform: () => true } });
    expect(startSubscription("pro")).toBe("unavailable");
    expect(open).not.toHaveBeenCalled();
  });

  it("the bridge wins over the browser check, even when Capacitor says native", () => {
    const launch = vi.fn();
    useWindow({ AllyBilling: { launch }, Capacitor: { isNativePlatform: () => true } });
    expect(startSubscription("ultra")).toBe("launched");
  });

  it("resolves productId and basePlanId from the config", () => {
    expect(tierProduct("pro")).toEqual({ productId: "ally_pro", basePlanId: "monthly" });
    expect(tierProduct("max")).toEqual({ productId: "ally_max", basePlanId: "monthly" });
    expect(tierProduct("ultra")).toEqual({ productId: "ally_ultra", basePlanId: "monthly" });
  });

  it("isWebPurchaseFlow is true only in a browser with no bridge (the CTA reads Get Ally on Google Play)", () => {
    useWindow({});
    expect(isWebPurchaseFlow()).toBe(true);
    useWindow({ AllyBilling: { launch: () => {} } });
    expect(isWebPurchaseFlow()).toBe(false);
    useWindow({ Capacitor: { isNativePlatform: () => true } });
    expect(isWebPurchaseFlow()).toBe(false);
  });
});

describe("restorePurchases", () => {
  it("asks the shell to restore when it can", async () => {
    const restore = vi.fn();
    const refetch = vi.fn().mockResolvedValue(undefined);
    useWindow({ AllyBilling: { restore } });
    await restorePurchases(refetch);
    expect(restore).toHaveBeenCalledOnce();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("otherwise just re-reads the server state", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    useWindow({});
    await restorePurchases(refetch);
    expect(refetch).toHaveBeenCalledOnce();
  });
});

describe("loadPrices", () => {
  it("falls back to the configured INR prices", async () => {
    useWindow({});
    expect(await loadPrices()).toEqual({ pro: "₹299", max: "₹499", ultra: "₹799" });
  });

  it("uses the localized strings the shell returns, tier by tier", async () => {
    useWindow({ AllyBilling: { getPrices: () => Promise.resolve({ ally_pro: "₹299.00", ally_ultra: "₹799.00" }) } });
    expect(await loadPrices()).toEqual({ pro: "₹299.00", max: "₹499", ultra: "₹799.00" });
  });

  it("accepts a synchronous getPrices and ignores blank or broken answers", async () => {
    useWindow({ AllyBilling: { getPrices: () => ({ ally_max: "  " }) } });
    expect((await loadPrices()).max).toBe("₹499");
    useWindow({ AllyBilling: { getPrices: () => Promise.reject(new Error("boom")) } });
    expect(await loadPrices()).toEqual({ pro: "₹299", max: "₹499", ultra: "₹799" });
  });
});

describe("the purchase result hook", () => {
  const handlers = (): PurchaseHandlers & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      refetchState: () => {
        calls.push("refetch");
        return Promise.resolve();
      },
      onSuccess: () => calls.push("back"),
      onError: () => calls.push("error"),
    };
  };

  it("success re-fetches the state, then returns to where the user came from", async () => {
    const h = handlers();
    await handlePurchaseResult({ status: "success" }, h);
    expect(h.calls).toEqual(["refetch", "back"]);
  });

  it("success still leaves the screen if the re-fetch fails", async () => {
    const h = handlers();
    h.refetchState = () => Promise.reject(new Error("offline"));
    await handlePurchaseResult({ status: "success" }, h);
    expect(h.calls).toEqual(["back"]);
  });

  it("cancelled does nothing", async () => {
    const h = handlers();
    await handlePurchaseResult({ status: "cancelled" }, h);
    expect(h.calls).toEqual([]);
  });

  it("error shows the inline error and does not re-fetch or leave", async () => {
    const h = handlers();
    await handlePurchaseResult({ status: "error" }, h);
    expect(h.calls).toEqual(["error"]);
  });

  it("installs window.onAllyPurchaseResult and restores the previous hook on cleanup", async () => {
    const previous = vi.fn();
    const w = useWindow({ onAllyPurchaseResult: previous });
    const h = handlers();
    const cleanup = installPurchaseResultHook(h);
    expect(w.onAllyPurchaseResult).not.toBe(previous);
    (w.onAllyPurchaseResult as (r: { status: string }) => void)({ status: "error" });
    await Promise.resolve();
    expect(h.calls).toEqual(["error"]);
    cleanup();
    expect(w.onAllyPurchaseResult).toBe(previous);
  });
});
