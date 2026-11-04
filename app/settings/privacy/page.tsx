"use client";

import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import { COPY } from "@/lib/copy";
import styles from "./page.module.css";

export default function PrivacySettingsPage() {
  const router = useRouter();
  const { state } = useAlly();
  const { openSheet } = useSheet();

  function downloadData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ally-data.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => router.push("/settings")}>
          <svg viewBox="0 0 24 24">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <h1 className={styles.title}>{COPY.privacy.title}</h1>
      </div>
      <div className={styles.body}>
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className={styles.row}>
          <span className={styles.rowLabel}>{COPY.privacy.policy}</span>
          <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
          </svg>
        </a>
        <button type="button" className={styles.row} onClick={downloadData}>
          <span className={styles.rowLabel}>{COPY.privacy.download}</span>
          <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
        </button>
        <button type="button" className={`${styles.row} ${styles.dangerRow}`} onClick={() => openSheet("delete")}>
          <span className={styles.rowLabel}>{COPY.privacy.delete}</span>
          <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
