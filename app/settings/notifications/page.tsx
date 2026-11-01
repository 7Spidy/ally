"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { useCompanionPrefs } from "@/state/useCompanionPrefs";
import { useToast } from "@/state/useToast";
import { ManifestGate } from "@/components/ManifestGate";
import { active } from "@/lib/selectors";
import { COPY } from "@/lib/copy";
import { firstNameFromFull } from "@/lib/engine";
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  dispatchNotification,
} from "@/lib/notifications";
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
  const { setNotify } = useCompanionPrefs();
  const { templates } = useManifest();
  const showToast = useToast();
  const activeList = active(state);

  const [permStatus, setPermStatus] = useState<"granted" | "denied" | "prompt">("prompt");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void getNotificationPermissionStatus().then(setPermStatus);
  }, []);

  async function handleRequestPermission() {
    const granted = await requestNotificationPermission();
    setPermStatus(granted ? "granted" : "denied");
    if (granted) {
      showToast("Notifications enabled!");
    } else {
      showToast("Notification permission was denied in system settings.");
    }
  }

  async function handleSendTestPing(companionId: string) {
    if (testing) return;
    setTesting(true);
    try {
      const res = await fetch("/api/chat/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companionId, force: true }),
      });

      const data = await res.json();
      if (data.pinged && data.message) {
        // Dispatch to client state
        dispatch({
          type: "RECEIVE_REPLY",
          companionId,
          message: data.message,
        });

        const companion = activeList.find((c) => c.id === companionId);
        const template = companion ? templates.find((t) => t.id === companion.templateId) : undefined;
        const name = template ? firstNameFromFull(template.name) : data.companionName || "Companion";
        const avatarUrl = template?.avatar ? `/${template.avatar}` : undefined;

        // Fire push notification
        await dispatchNotification({
          title: name,
          body: data.message.text,
          companionId,
          icon: avatarUrl,
        });

        showToast(`Sent test ping from ${name}!`);
      } else {
        showToast(data.message || "Could not generate ping.");
      }
    } catch (err) {
      console.error("Test ping failed:", err);
      showToast("Failed to send test ping.");
    } finally {
      setTesting(false);
    }
  }

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
        <p className={styles.intro}>
          Your companions will occasionally text you when you are away—either to follow up on an ongoing topic or share spontaneous thoughts in character.
        </p>

        {permStatus !== "granted" && (
          <div className={styles.permissionBanner}>
            <span className={styles.permissionText}>
              Device push notifications are not yet enabled. Allow notifications so your companions can reach you when the app is closed.
            </span>
            <button type="button" className={styles.permissionBtn} onClick={handleRequestPermission}>
              Enable Device Notifications
            </button>
          </div>
        )}

        <div className={styles.sectionHeader}>Companions</div>

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
                onClick={async () => {
                  if (!c.notify && permStatus !== "granted") {
                    await handleRequestPermission();
                  }
                  setNotify(c.id, !c.notify);
                }}
              >
                <span className={styles.toggleKnob} />
              </button>
            </div>
          );
        })}

        {activeList.length > 0 && (
          <div className={styles.testContainer}>
            <button
              type="button"
              className={styles.testBtn}
              disabled={testing}
              onClick={() => handleSendTestPing(activeList[0].id)}
            >
              {testing ? "Generating ping..." : `Test Ping from ${templates.find((t) => t.id === activeList[0].templateId)?.name.split(" ")[0] || "Companion"}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
