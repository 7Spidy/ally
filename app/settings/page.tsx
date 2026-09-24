"use client";

import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useAuth } from "@/state/useAuth";
import { COPY, fill } from "@/lib/copy";
import { freeLeft, passActive } from "@/lib/ledger";
import { formatTimeIST, serverNow } from "@/lib/clock";
import styles from "./page.module.css";

export default function SettingsPage() {
  const router = useRouter();
  const { state } = useAlly();
  const auth = useAuth();
  // Ledger state is judged on the server's clock (spec D8), never the debug clock.
  const onPass = passActive(state.ledger, serverNow());
  const n = freeLeft(state.ledger, serverNow());

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
          <div className={styles.row}>
            <span className={styles.rowLabel}>{COPY.settings.name}</span>
            <span className={styles.rowValue}>{state.user.displayName}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{COPY.settings.signedInWith}</span>
            <span className={styles.rowValue}>
              {auth.isAnonymous ? COPY.settings.notSaved : auth.email}
            </span>
          </div>
          <button type="button" className={styles.row} onClick={() => router.push("/settings/account")}>
            <span className={styles.rowLabel}>{COPY.settings.account}</span>
          </button>
          <button type="button" className={styles.row} onClick={() => router.push("/settings/privacy")}>
            <span className={styles.rowLabel}>{COPY.settings.privacy}</span>
          </button>
          <button type="button" className={styles.row} onClick={() => router.push("/settings/how")}>
            <span className={styles.rowLabel}>{COPY.settings.how}</span>
          </button>
        </div>

        <div className={styles.group}>
          <p className={styles.groupLabel}>{COPY.settings.groupCompanions}</p>
          <button type="button" className={styles.row} onClick={() => router.push("/settings/notifications")}>
            <span className={styles.rowLabel}>{COPY.settings.notifications}</span>
          </button>
        </div>

        <div className={styles.group}>
          <p className={styles.groupLabel}>{COPY.settings.groupPlan}</p>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{onPass ? COPY.settings.planPass : COPY.settings.planFree}</span>
            <span className={styles.rowValue}>
              {onPass
                ? fill(COPY.settings.planPassUntil, { time: formatTimeIST((state.ledger.pass as NonNullable<typeof state.ledger.pass>).endsAt) })
                : fill(COPY.settings.planFreeLeft, { n })}
            </span>
          </div>
        </div>

        <p className={`meta ${styles.footer}`}>{COPY.settings.footer}</p>
      </div>
    </div>
  );
}
