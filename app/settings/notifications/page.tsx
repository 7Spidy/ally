"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { useCompanionPrefs } from "@/state/useCompanionPrefs";
import { useToast } from "@/state/useToast";
import { useAuth } from "@/state/useAuth";
import { useQaAccess } from "@/components/qa/useQaAccess";
import { ManifestGate } from "@/components/ManifestGate";
import { active, lastOpened } from "@/lib/selectors";
import { COPY, fill } from "@/lib/copy";
import { firstNameFromFull } from "@/lib/engine";
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  dispatchNotification,
  triggerTestDailyReminder,
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
  const auth = useAuth();
  // The test buttons are developer tools: they are not in the page at all for anyone but QA and admin profiles.
  const { qa } = useQaAccess(auth.user?.id);
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
      showToast(COPY.notifications.enabled);
    } else {
      showToast(COPY.notifications.denied);
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
        const name = template ? firstNameFromFull(template.name) : data.companionName || COPY.notifications.fallbackName;
        const avatarUrl = template?.avatar ? `/${template.avatar}` : undefined;

        // Fire push notification
        await dispatchNotification({
          title: name,
          body: data.message.text,
          companionId,
          icon: avatarUrl,
        });

        showToast(fill(COPY.notifications.testPingSent, { name }));
      } else {
        showToast(data.message || COPY.notifications.testPingNone);
      }
    } catch (err) {
      console.error("Test ping failed:", err);
      showToast(COPY.notifications.testPingFailed);
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
        <p className={styles.intro}>{COPY.notifications.intro}</p>

        {permStatus !== "granted" && (
          <div className={styles.permissionBanner}>
            <span className={styles.permissionText}>{COPY.notifications.permissionBanner}</span>
            <button type="button" className={styles.permissionBtn} onClick={handleRequestPermission}>
              {COPY.notifications.enable}
            </button>
          </div>
        )}

        <div className={styles.sectionHeader}>{COPY.notifications.companions}</div>

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

        {qa && activeList.length > 0 && (
          <div className={styles.testContainer}>
            <button
              type="button"
              className={styles.testBtn}
              disabled={testing}
              onClick={() => handleSendTestPing(activeList[0].id)}
            >
              {testing
                ? COPY.notifications.testPingBusy
                : fill(COPY.notifications.testPing, { name: templates.find((t) => t.id === activeList[0].templateId)?.name.split(" ")[0] || COPY.notifications.fallbackName })}
            </button>
          </div>
        )}

        <div className={styles.sectionHeader}>{COPY.notifications.dailyHeading}</div>
        <p className={styles.intro} style={{ marginTop: 0 }}>
          {COPY.notifications.dailyBody}
        </p>

        {qa && (
        <div className={styles.testContainer} style={{ marginTop: 12 }}>
          <button
            type="button"
            className={styles.testBtn}
            onClick={async () => {
              if (permStatus !== "granted") {
                await handleRequestPermission();
              }
              const primary = lastOpened(state) ?? activeList[0];
              const template = primary ? templates.find((t) => t.id === primary.templateId) : undefined;
              const name = template ? firstNameFromFull(template.name) : undefined;
              await triggerTestDailyReminder(
                {
                  companionName: name,
                  companionId: primary?.id,
                  companionCount: activeList.length,
                },
                "midday"
              );
              showToast(COPY.notifications.middaySent);
            }}
          >
            {COPY.notifications.testMidday}
          </button>
          <button
            type="button"
            className={styles.testBtn}
            style={{ marginTop: 8 }}
            onClick={async () => {
              if (permStatus !== "granted") {
                await handleRequestPermission();
              }
              const primary = lastOpened(state) ?? activeList[0];
              const template = primary ? templates.find((t) => t.id === primary.templateId) : undefined;
              const name = template ? firstNameFromFull(template.name) : undefined;
              await triggerTestDailyReminder(
                {
                  companionName: name,
                  companionId: primary?.id,
                  companionCount: activeList.length,
                },
                "evening"
              );
              showToast(COPY.notifications.eveningSent);
            }}
          >
            {COPY.notifications.testEvening}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
