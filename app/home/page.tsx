"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { ManifestGate } from "@/components/ManifestGate";
import { active, lastOpened } from "@/lib/selectors";
import { deckTemplates } from "@/lib/engine";
import { excludedFaces } from "@/lib/selectors";
import { now } from "@/lib/clock";
import { addCardState } from "@/lib/addCard";
import { HomeBar } from "@/components/HomeBar";
import { CompanionCard } from "@/components/CompanionCard";
import { AddCard } from "@/components/AddCard";
import { Pips, type PipItem } from "@/components/Pips";
import styles from "./page.module.css";

const CARD_WIDTH = 300;
const CARD_GAP = 18;

export default function HomePage() {
  return (
    <ManifestGate>
      <HomeContent />
    </ManifestGate>
  );
}

function HomeContent() {
  const router = useRouter();
  const { state } = useAlly();
  const { templates } = useManifest();
  const carouselRef = useRef<HTMLDivElement>(null);

  const activeList = active(state);
  const excluded = excludedFaces(state);
  const bothPoolsEmpty =
    deckTemplates(templates, "woman", excluded).length === 0 &&
    deckTemplates(templates, "man", excluded).length === 0;
  const addKind = addCardState(activeList.length, bothPoolsEmpty);

  const items = useMemo(
    () => [
      ...activeList.map((c) => ({ key: c.id, companion: c, template: templates.find((t) => t.id === c.templateId) })),
      { key: "add" as const, companion: undefined, template: undefined },
    ],
    [activeList, templates]
  );

  // Centre on the companion the user came from, or the first card, on
  // mount. Rather than parsing document.referrer or a query param,
  // lastOpened(state) already is "the companion the user came from"
  // whenever the user arrived by backing out of a chat (OPEN_CHAT just
  // stamped lastOpenedAt on the way in); it's also a well-defined fallback
  // for every other entry path (splash, settings, a sheet).
  const initialKeyRef = useRef<string>("add");
  if (initialKeyRef.current === "add" && items.length) {
    const lo = lastOpened(state);
    initialKeyRef.current = lo ? lo.id : items[0].key;
  }
  const [centeredKey, setCenteredKey] = useState(initialKeyRef.current);

  useEffect(() => {
    const el = carouselRef.current;
    if (!el) return;
    const idx = items.findIndex((i) => i.key === initialKeyRef.current);
    if (idx < 0) return;
    el.scrollLeft = idx * (CARD_WIDTH + CARD_GAP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScroll() {
    const el = carouselRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / (CARD_WIDTH + CARD_GAP));
    const item = items[Math.max(0, Math.min(items.length - 1, idx))];
    if (item) setCenteredKey(item.key);
  }

  function scrollToKey(key: string) {
    const el = carouselRef.current;
    if (!el) return;
    const idx = items.findIndex((i) => i.key === key);
    if (idx < 0) return;
    el.scrollTo({ left: idx * (CARD_WIDTH + CARD_GAP), behavior: "smooth" });
  }

  function openKey(key: string) {
    scrollToKey(key);
    if (key === "add") return; // the add card's own button opens the intro sheet
    router.push(`/chat/${key}`);
  }

  const pipItems: PipItem[] = items
    .filter((i) => i.companion && i.template)
    .map((i) => ({ key: i.key, companion: i.companion, template: i.template }));

  return (
    <div className={styles.page}>
      <HomeBar ledger={state.ledger} now={now()} displayName={state.user.displayName} />
      <div className={styles.carouselWrap}>
        <div className={styles.carousel} ref={carouselRef} onScroll={handleScroll}>
          {items.map((item) => (
            <div key={item.key}>
              {item.companion && item.template ? (
                <CompanionCard companion={item.companion} template={item.template} />
              ) : (
                <AddCard kind={addKind} activeCount={activeList.length} />
              )}
            </div>
          ))}
        </div>
      </div>
      <Pips
        items={pipItems}
        showPlus={addKind === "add"}
        centeredKey={centeredKey}
        onScrollTo={scrollToKey}
        onOpen={openKey}
      />
    </div>
  );
}
