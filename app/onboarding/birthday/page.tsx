"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { now } from "@/lib/clock";
import { BLOCK_KEY } from "@/lib/migrate";
import { COPY } from "@/lib/copy";
import { applyGate } from "@/lib/gate";
import { invalidationFor } from "../_lib/invalidate";
import { useOnboardingToast } from "../_lib/Toast";
import styles from "./page.module.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function daysIn(month: number, year: number) {
  return new Date(year, month, 0).getDate();
}

export default function BirthdayPage() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const toast = useOnboardingToast();
  const thisYear = new Date(now()).getFullYear();
  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = thisYear; y >= 1920; y--) arr.push(y);
    return arr;
  }, [thisYear]);

  const initial = state.flow?.dob ? state.flow.dob.split("-").map(Number) : [2002, 1, 1];
  const [year, setYear] = useState(initial[0]);
  const [month, setMonth] = useState(initial[1]);
  const [day, setDay] = useState(initial[2]);

  useEffect(() => {
    if (state.flow?.kind === "round2") router.replace("/onboarding/gender");
  }, [state.flow, router]);

  const maxDay = daysIn(month, year);
  useEffect(() => {
    if (day > maxDay) setDay(maxDay);
  }, [maxDay, day]);

  if (!state.flow || state.flow.kind === "round2") return null;

  function onContinue() {
    if (!state.flow) return;
    const p = (n: number) => String(n).padStart(2, "0");
    const iso = `${year}-${p(month)}-${p(day)}`;
    const nowMs = now();
    const gate = applyGate(iso, nowMs);
    if (gate.blocked) {
      try {
        window.localStorage.setItem(BLOCK_KEY, String(gate.blockedUntil));
      } catch {
        /* storage full or blocked; the block is best-effort */
      }
      router.replace("/blocked");
      return;
    }
    if (iso !== state.flow.dob) {
      const { patch, changed } = invalidationFor("birthday", state.flow);
      if (changed && patch) {
        dispatch({ type: "INVALIDATE", patch });
        toast(COPY.recompute.toast);
      }
    }
    dispatch({ type: "SET_BIRTHDAY", dob: gate.dob, age: gate.age });
    router.push("/onboarding/questions/disclosure");
  }

  return (
    <>
      <div className="stack">
        <h1 className="q">{COPY.birthday.question}</h1>
        <p className="sub">{COPY.birthday.sub}</p>
        <div className={styles.drums}>
          <select className={styles.drum} aria-label="Day" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select className={styles.drum} aria-label="Month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select className={styles.drum} aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={onContinue}>
          {COPY.consent.action}
        </button>
      </div>
    </>
  );
}
