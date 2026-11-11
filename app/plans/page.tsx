"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { PLAN_CONFIG, PLAY_SUBSCRIPTIONS_URL, TIER_ORDER, type PlanId } from "@/lib/config";
import { COPY, fill } from "@/lib/copy";
import { firstNameFromFull } from "@/lib/engine";
import { activeCount, isPaid } from "@/lib/entitlement";
import { installPurchaseResultHook, isWebPurchaseFlow, loadPrices, restorePurchases, startSubscription } from "@/lib/billing";
import { ctaState, parseFrom, plansView, ultraFull } from "@/lib/plans";
import styles from "./page.module.css";

export default function PlansPage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <PlansContent />
    </Suspense>
  );
}

function PlansContent() {
  const router = useRouter();
  const params = useSearchParams();
  const from = parseFrom(params.get("from"));
  const { state, reloadServerState } = useAlly();
  const { templates } = useManifest();
  const ent = state.entitlement;
  const view = plansView(from, ent);
  const subscribed = isPaid(ent.plan);

  const [sel, setSel] = useState<PlanId>(view.pick);
  const [prices, setPrices] = useState<Record<PlanId, string>>(() => ({
    pro: `₹${PLAN_CONFIG.tiers.pro.price}`,
    max: `₹${PLAN_CONFIG.tiers.max.price}`,
    ultra: `₹${PLAN_CONFIG.tiers.ultra.price}`,
  }));
  const [webFlow, setWebFlow] = useState(false);
  const [payError, setPayError] = useState(false);
  const [restored, setRestored] = useState(false);
  const radios = useRef<Record<string, HTMLButtonElement | null>>({});

  // Back to wherever the user came from; the home screen when this was the first page.
  const leave = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.replace("/home");
  }, [router]);

  useEffect(() => {
    setWebFlow(isWebPurchaseFlow());
    let alive = true;
    void loadPrices().then((p) => alive && setPrices(p));
    return () => {
      alive = false;
    };
  }, []);

  // The Android shell reports the purchase here (window.onAllyPurchaseResult).
  useEffect(
    () => installPurchaseResultHook({ refetchState: reloadServerState, onSuccess: leave, onError: () => setPayError(true) }),
    [reloadServerState, leave]
  );

  if (ultraFull(from, ent, activeCount(state.companions))) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <button type="button" className={styles.close} aria-label={COPY.plans.close} onClick={leave}>
            &times;
          </button>
        </header>
        <section className={styles.hero}>
          <h1 className={styles.h1}>{COPY.home.capCardTitle}</h1>
          <p className={styles.sub}>{COPY.home.capCardBody}</p>
        </section>
      </div>
    );
  }

  const cta = ctaState(sel, ent, prices, webFlow);
  const nameOf = (templateId: string) => {
    const t = templates.find((x) => x.id === templateId);
    return t ? firstNameFromFull(t.name) : "";
  };
  const deeper = ent.plan === "ultra" ? [] : state.companions.filter((c) => c.status === "active" && c.deeperLevelAvailable);

  function onRadioKey(e: React.KeyboardEvent, idx: number) {
    let next = idx;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (idx + 1) % TIER_ORDER.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (idx - 1 + TIER_ORDER.length) % TIER_ORDER.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TIER_ORDER.length - 1;
    else return;
    e.preventDefault();
    setSel(TIER_ORDER[next]);
    radios.current[TIER_ORDER[next]]?.focus();
  }

  function subscribe() {
    if (cta.disabled) return;
    setPayError(false);
    // The purchase result comes back through window.onAllyPurchaseResult (installed above).
    if (startSubscription(sel) === "unavailable") setPayError(true);
  }

  async function restore() {
    setRestored(false);
    try {
      await restorePurchases(reloadServerState);
      setRestored(true);
    } catch {
      setPayError(true);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {view.showClose && (
          <button type="button" className={styles.close} aria-label={COPY.plans.close} data-testid="plans-close" onClick={leave}>
            &times;
          </button>
        )}
      </header>

      <div className={styles.scroll}>
        <section className={styles.hero}>
          <h1 className={styles.h1} data-testid="plans-head">
            {view.head}
          </h1>
          <p className={styles.sub}>{view.sub}</p>
          {view.meter && (
            <div className={styles.meter} data-testid="plans-meter">
              <div className={styles.meterBar}>
                <i style={{ width: `${view.meter.pct}%` }} />
              </div>
              <span>{view.meter.text}</span>
            </div>
          )}
        </section>

        <div className={styles.tiers} role="radiogroup" aria-label={COPY.plans.pickerLabel}>
          {TIER_ORDER.map((id, idx) => {
            const tier = PLAN_CONFIG.tiers[id];
            const copy = COPY.plans[id];
            const checked = sel === id;
            return (
              <button
                key={id}
                ref={(el) => {
                  radios.current[id] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                className={styles.tier}
                data-testid={`tier-${id}`}
                data-current={ent.plan === id ? "true" : undefined}
                onClick={() => setSel(id)}
                onKeyDown={(e) => onRadioKey(e, idx)}
              >
                <span className={styles.row}>
                  <span className={styles.name}>{tier.name}</span>
                  <span className={styles.price}>
                    {prices[id]}
                    <small>{COPY.plans.perMonth}</small>
                  </span>
                </span>
                <span className={styles.tag}>{ent.plan === id ? COPY.plans.yourPlan : copy.tag}</span>
                <ul className={styles.feats}>
                  {copy.lead && <li className={styles.lead}>{copy.lead}</li>}
                  {copy.feats.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        {deeper.map((c) => (
          <button key={c.id} type="button" className={styles.deeperRow} data-testid="plans-deeper-row" onClick={() => setSel("ultra")}>
            {fill(COPY.plans.deeperRow, { name: nameOf(c.templateId) })}
          </button>
        ))}

        {view.later === "maybeLater" && (
          <p className={styles.later}>
            <button type="button" data-testid="plans-later" onClick={leave}>
              {COPY.plans.maybeLater}
            </button>
          </p>
        )}
        {view.later === "readChats" && (
          <p className={styles.later}>
            <button type="button" data-testid="plans-read-chats" onClick={() => router.replace("/home")}>
              {COPY.plans.readChats}
            </button>
          </p>
        )}
        {subscribed && (
          <p className={styles.later}>
            <a href={PLAY_SUBSCRIPTIONS_URL} target="_blank" rel="noopener noreferrer" data-testid="plans-manage">
              {COPY.plans.manage}
            </a>
          </p>
        )}
      </div>

      <div className={styles.footer}>
        <button type="button" className="btn primary" data-testid="plans-cta" disabled={cta.disabled} onClick={subscribe}>
          {cta.label}
        </button>
        {payError && (
          <p className={styles.error} role="alert" data-testid="plans-error">
            {COPY.plans.payError}
          </p>
        )}
        <p className={styles.fine}>
          {COPY.plans.fine}
          <br />
          <button type="button" data-testid="plans-restore" onClick={() => void restore()}>
            {COPY.plans.restore}
          </button>
        </p>
        {restored && (
          <p className={styles.fine} role="status">
            {COPY.plans.restored}
          </p>
        )}
      </div>
    </div>
  );
}
