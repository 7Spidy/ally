import { Capacitor } from "@capacitor/core";

export interface PushNotificationPayload {
  title: string;
  body: string;
  companionId: string;
  icon?: string;
  extra?: Record<string, unknown>;
}

let notificationListenerRegistered = false;

/**
 * Initializes notification listeners (e.g. action click to open companion chat).
 */
export async function initNotificationService(onOpenChat?: (companionId: string) => void) {
  if (typeof window === "undefined") return;

  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");

      // Set up Android default channel
      await LocalNotifications.createChannel({
        id: "ally_messages",
        name: "Companion Messages",
        description: "Messages and pings from your Ally companions",
        importance: 4, // High importance
        visibility: 1,
        vibration: true,
      });

      if (!notificationListenerRegistered && onOpenChat) {
        notificationListenerRegistered = true;
        LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
          const companionId = action.notification.extra?.companionId;
          if (companionId && typeof companionId === "string") {
            onOpenChat(companionId);
          }
        });
      }
    } catch (err) {
      console.warn("Failed to init native notification service:", err);
    }
  }
}

/**
 * Checks whether notifications are allowed on this device.
 */
export async function getNotificationPermissionStatus(): Promise<"granted" | "denied" | "prompt"> {
  if (typeof window === "undefined") return "denied";

  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const status = await LocalNotifications.checkPermissions();
      if (status.display === "granted") return "granted";
      if (status.display === "denied") return "denied";
      return "prompt";
    } catch {
      return "prompt";
    }
  }

  if ("Notification" in window) {
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    return "prompt";
  }

  return "denied";
}

/**
 * Requests notification permissions from the OS/browser.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const res = await LocalNotifications.requestPermissions();
      return res.display === "granted";
    } catch (err) {
      console.warn("Native notification request failed:", err);
      return false;
    }
  }

  if ("Notification" in window) {
    try {
      const res = await Notification.requestPermission();
      return res === "granted";
    } catch (err) {
      console.warn("Browser notification request failed:", err);
      return false;
    }
  }

  return false;
}

/**
 * Dispatches a push notification to the user's device.
 */
export async function dispatchNotification({
  title,
  body,
  companionId,
  icon,
  extra = {},
}: PushNotificationPayload) {
  if (typeof window === "undefined") return;

  const notifId = Math.floor(Date.now() % 10000000);

  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
            title,
            body,
            channelId: "ally_messages",
            smallIcon: "ic_launcher_round",
            extra: { companionId, ...extra },
          },
        ],
      });
      return;
    } catch (err) {
      console.warn("Native schedule notification failed:", err);
    }
  }

  // Fallback to web notification
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const notif = new Notification(title, {
        body,
        icon: icon || "/assets/logo/ally-logo.png",
        data: { companionId },
      });
      notif.onclick = () => {
        window.focus();
        window.location.href = `/chat/${companionId}`;
        notif.close();
      };
    } catch (err) {
      console.warn("Web notification failed:", err);
    }
  }
}
