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
        <button type="button" className={styles.row} onClick={downloadData}>
          {COPY.privacy.download}
        </button>
        <button type="button" className={styles.row} onClick={() => openSheet("delete")}>
          {COPY.privacy.delete}
        </button>
      </div>
    </div>
  );
}
