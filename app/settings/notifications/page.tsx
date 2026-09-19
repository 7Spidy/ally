"use client";

import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { ManifestGate } from "@/components/ManifestGate";
import { active } from "@/lib/selectors";
import { COPY } from "@/lib/copy";
import { firstNameFromFull } from "@/lib/engine";
import styles from "./page.module.css";

export default function NotificationsSettingsPage() {
  return (
    <ManifestGate>
      <NotificationsContent />
    </ManifestGate>
  );
}

function NotificationsContent() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const { templates } = useManifest();
  const activeList = active(state);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => router.push("/settings")}>
          <svg viewBox="0 0 24 24">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <h1 className={styles.title}>{COPY.notifications.title}</h1>
      </div>
      <div className={styles.body}>
        {activeList.map((c) => {
          const template = templates.find((t) => t.id === c.templateId);
          const name = template ? firstNameFromFull(template.name) : "";
          return (
            <div className={styles.row} key={c.id}>
              <span>{name}</span>
              <button
                type="button"
                className={`${styles.toggle} ${c.notify ? styles.on : ""}`}
                role="switch"
                aria-checked={c.notify}
                aria-label={name}
                onClick={() => dispatch({ type: "SET_NOTIFY", companionId: c.id, notify: !c.notify })}
              >
                <span className={styles.toggleKnob} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
