"use client";

import { useRouter } from "next/navigation";
import { COPY } from "@/lib/copy";
import styles from "./page.module.css";

export default function HowSettingsPage() {
  const router = useRouter();

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => router.push("/settings")}>
          <svg viewBox="0 0 24 24">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <h1 className={styles.title}>{COPY.how.title}</h1>
      </div>
      <div className={styles.body}>
        {COPY.how.body.map((p, i) => (
          <p key={i} className={styles.paragraph}>
            {p}
          </p>
        ))}
      </div>
    </div>
  );
}
