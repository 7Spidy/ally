"use client";

import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useAuth } from "@/state/useAuth";
import { COPY } from "@/lib/copy";
import { planRowText } from "@/lib/plans";
import styles from "./page.module.css";

export default function SettingsPage() {
  const router = useRouter();
  const { state } = useAlly();
  const auth = useAuth();

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => router.push("/home")}>
          <svg viewBox="0 0 24 24">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <h1 className={styles.title}>{COPY.settings.title}</h1>
      </div>

      <div className={styles.body}>
        <div className={styles.group}>
          <p className={styles.groupLabel}>{COPY.settings.groupYou}</p>
          <div className={`${styles.row} ${styles.staticRow}`}>
            <span className={styles.rowLabel}>{COPY.settings.name}</span>
            <span className={styles.rowValue}>{state.user.displayName}</span>
          </div>
          <div className={`${styles.row} ${styles.staticRow}`}>
            <span className={styles.rowLabel}>{COPY.settings.signedInWith}</span>
            <span className={styles.rowValue}>
              {auth.isAnonymous ? COPY.settings.notSaved : auth.email}
            </span>
          </div>
          <button type="button" className={`${styles.row} ${styles.actionRow}`} onClick={() => router.push("/settings/account")}>
            <span className={styles.rowLabel}>{COPY.settings.account}</span>
            <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <button type="button" className={`${styles.row} ${styles.actionRow}`} onClick={() => router.push("/settings/privacy")}>
            <span className={styles.rowLabel}>{COPY.settings.privacy}</span>
            <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <button type="button" className={`${styles.row} ${styles.actionRow}`} onClick={() => router.push("/settings/how")}>
            <span className={styles.rowLabel}>{COPY.settings.how}</span>
            <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <div className={styles.group}>
          <p className={styles.groupLabel}>{COPY.settings.groupCompanions}</p>
          <button type="button" className={`${styles.row} ${styles.actionRow}`} onClick={() => router.push("/settings/notifications")}>
            <span className={styles.rowLabel}>{COPY.settings.notifications}</span>
            <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <div className={styles.group}>
          <p className={styles.groupLabel}>{COPY.settings.groupPlan}</p>
          <button type="button" className={`${styles.row} ${styles.actionRow}`} data-testid="settings-plan" onClick={() => router.push("/plans?from=settings")}>
            <span className={styles.rowLabel}>{COPY.settings.planRow}</span>
            <span className={styles.rowValue}>{planRowText(state.entitlement)}</span>
            <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <p className={`meta ${styles.footer}`}>{COPY.settings.footer}</p>
      </div>
    </div>
  );
}
