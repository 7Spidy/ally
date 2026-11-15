"use client";

import { useEffect, useRef, useState } from "react";
import { COPY, fill } from "@/lib/copy";
import { deleteMemoryFact, getMemoryFacts, rpcErrorMessage, type MemoryFact } from "@/lib/supabase/queries";
import styles from "./MemoryList.module.css";

/** The order the groups are shown in, matching memory_facts.category. */
const CATEGORY_ORDER = ["people", "work", "schedule", "dates", "tastes", "jokes", "promises", "other"] as const;
type Category = (typeof CATEGORY_ORDER)[number];

/** How long a first tap on Delete stays armed. */
const ARM_MS = 4000;

/**
 * What a companion remembers about the user, grouped under plain labels, with
 * a delete control on each line: the first tap arms it, the second deletes the
 * fact for good. She can learn it again if it comes up. Summaries are not shown.
 */
export function MemoryList({ companionId, personaName, onError }: { companionId: string; personaName: string; onError: (message: string) => void }) {
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let alive = true;
    getMemoryFacts(companionId)
      .then((list) => alive && setFacts(list))
      .catch((e) => {
        if (!alive) return;
        setFacts([]);
        onErrorRef.current(rpcErrorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [companionId]);

  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    []
  );

  async function onForget(f: MemoryFact) {
    if (armed !== f.id) {
      setArmed(f.id);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmed((cur) => (cur === f.id ? null : cur)), ARM_MS);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmed(null);
    try {
      await deleteMemoryFact(f.id);
      setFacts((cur) => (cur ? cur.filter((x) => x.id !== f.id) : cur));
    } catch (e) {
      onErrorRef.current(rpcErrorMessage(e));
    }
  }

  if (facts === null) return null;

  const groups = CATEGORY_ORDER.map((c) => ({ category: c as Category, items: facts.filter((f) => f.category === c) })).filter((g) => g.items.length > 0);

  return (
    <section className={styles.section} aria-labelledby="remembers-heading" data-testid="memory-list">
      <h2 id="remembers-heading" className={styles.heading}>
        {fill(COPY.profile.remembers, { persona: personaName })}
      </h2>
      {groups.length === 0 && (
        <p className={styles.empty} data-testid="memory-empty">
          {COPY.profile.remembersEmpty}
        </p>
      )}
      {groups.map((g) => (
        <div key={g.category} className={styles.group}>
          <h3 className={styles.label}>{COPY.profile.categories[g.category]}</h3>
          <ul className={styles.items}>
            {g.items.map((f) => (
              <li key={f.id} className={styles.item} data-testid="memory-fact">
                <span className={styles.fact}>{f.fact}</span>
                <button
                  type="button"
                  className={styles.forget}
                  data-armed={armed === f.id ? "true" : "false"}
                  aria-label={COPY.profile.forget}
                  onClick={() => void onForget(f)}
                >
                  {armed === f.id ? COPY.profile.forget : "×"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
