"use client";

import { useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/Sheet";
import { COPY } from "@/lib/copy";
import { now } from "@/lib/clock";
import { applyGate } from "@/lib/gate";
import styles from "./AgeCheckSheet.module.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Blocks the composer while a chat is paused for an age check. Re-enter the
 * date of birth, validated with the same gate as the birthday screen.
 * `onUnder18` runs the existing blocked flow; `onAdult` gets the ISO date
 * for the server-side clear_age_check.
 */
export function AgeCheckSheet({ onAdult, onUnder18, error }: { onAdult: (dob: string) => void; onUnder18: () => void; error?: boolean }) {
  const thisYear = new Date(now()).getFullYear();
  const years = useMemo(() => Array.from({ length: thisYear - 1920 + 1 }, (_, i) => thisYear - i), [thisYear]);
  const [year, setYear] = useState(2002);
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const maxDay = new Date(year, month, 0).getDate();
  useEffect(() => {
    if (day > maxDay) setDay(maxDay);
  }, [day, maxDay]);

  function submit() {
    const p = (n: number) => String(n).padStart(2, "0");
    const iso = `${year}-${p(month)}-${p(day)}`;
    const gate = applyGate(iso, now());
    if (gate.blocked) onUnder18();
    else onAdult(iso);
  }

  return (
    <Sheet labelledBy="ageCheckHeading">
      <h2 id="ageCheckHeading" className={styles.heading}>
        {COPY.live.ageSheetHeading}
      </h2>
      <p className={styles.body}>{COPY.live.ageSheetBody}</p>
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
      {error && (
        <p className={styles.error} role="alert">
          {COPY.live.ageSheetError}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn primary" onClick={submit}>
          {COPY.live.ageSheetAction}
        </button>
      </div>
    </Sheet>
  );
}
