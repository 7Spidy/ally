import { Capacitor } from "@capacitor/core";

export interface PushNotificationPayload {
  title: string;
  body: string;
  companionId?: string;
  icon?: string;
  extra?: Record<string, unknown>;
}

export const DAILY_REMINDER_MIDDAY_ID = 8801;
export const DAILY_REMINDER_EVENING_ID = 8802;

export interface DailyReminderOptions {
  companionName?: string;
  companionId?: string;
  companionCount?: number;
}

let notificationListenerRegistered = false;

/**
 * Initializes notification listeners (e.g. action click to open companion chat).
 */
export async function initNotificationService(onOpenTarget?: (target: string) => void) {
  if (typeof window === "undefined") return;

  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");

      // Set up Android default channel
      await LocalNotifications.createChannel({
        id: "ally_messages",
        name: "Companion Messages",
        description: "Messages, pings, and daily reminders from your Ally companions",
        importance: 4, // High importance
        visibility: 1,
        vibration: true,
      });

      if (!notificationListenerRegistered && onOpenTarget) {
        notificationListenerRegistered = true;
        LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
          const companionId = action.notification.extra?.companionId;
          const route = action.notification.extra?.route;
          if (companionId && typeof companionId === "string") {
            onOpenTarget(companionId);
          } else if (route && typeof route === "string") {
            onOpenTarget(route);
          } else {
            onOpenTarget("home");
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
 * Schedules two recurring daily local notifications:
 * 1. Midday (1:00 PM / 13:00) - Afternoon catch-up with waiting characters
 * 2. Evening (8:00 PM / 20:00) - Evening wind-down / chat check-in
 *
 * Tapping either notification brings the app to the foreground and opens
 * the character's chat or companion home screen.
 */
export async function scheduleDailyReminders(options: DailyReminderOptions = {}) {
  if (typeof window === "undefined") return;

  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");

      // Check permission before scheduling
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== "granted") {
        return;
      }

      // Cleanly replace existing daily reminders to update with current character
      try {
        await LocalNotifications.cancel({
          notifications: [
            { id: DAILY_REMINDER_MIDDAY_ID },
            { id: DAILY_REMINDER_EVENING_ID },
          ],
        });
      } catch {
        /* noop if not scheduled */
      }

      const { companionName, companionId, companionCount = 1 } = options;

      const middayTitle = companionName
        ? `${companionName} is waiting for you`
        : companionCount > 1
        ? "Your companions are waiting"
        : "Ally is waiting to chat";

      const middayBody = companionName
        ? `Take a quick break — ${companionName} is waiting to chat and catch up.`
        : "Take a pause from your busy day — open Ally to catch up with your characters.";

      const eveningTitle = companionName
        ? `${companionName} wants to catch up`
        : companionCount > 1
        ? "Your companions are thinking of you"
        : "Time to unwind with Ally";

      const eveningBody = companionName
        ? `How was your day? ${companionName} is here to talk and unwind with you tonight.`
        : "End your day with a thoughtful conversation. Your companions are waiting for you.";

      await LocalNotifications.schedule({
        notifications: [
          {
            id: DAILY_REMINDER_MIDDAY_ID,
            title: middayTitle,
            body: middayBody,
            channelId: "ally_messages",
            smallIcon: "ic_launcher_round",
            schedule: {
              on: { hour: 13, minute: 0 }, // 1:00 PM daily
              allowWhileIdle: true,
            },
            extra: {
              companionId,
              route: companionId ? `/chat/${companionId}` : "/home",
              isDailyReminder: true,
              period: "midday",
            },
          },
          {
            id: DAILY_REMINDER_EVENING_ID,
            title: eveningTitle,
            body: eveningBody,
            channelId: "ally_messages",
            smallIcon: "ic_launcher_round",
            schedule: {
              on: { hour: 20, minute: 0 }, // 8:00 PM daily
              allowWhileIdle: true,
            },
            extra: {
              companionId,
              route: companionId ? `/chat/${companionId}` : "/home",
              isDailyReminder: true,
              period: "evening",
            },
          },
        ],
      });
    } catch (err) {
      console.warn("Failed to schedule daily reminders:", err);
    }
  }
}

/**
 * Fires an immediate test of the daily reminder so the developer/user can verify
 * the exact notification appearance, copy, and click-to-open behavior.
 */
export async function triggerTestDailyReminder(
  options: DailyReminderOptions = {},
  period: "midday" | "evening" = "midday"
) {
  const { companionName, companionId, companionCount = 1 } = options;

  const title =
    period === "midday"
      ? companionName
        ? `${companionName} is waiting for you`
        : companionCount > 1
        ? "Your companions are waiting"
        : "Ally is waiting to chat"
      : companionName
      ? `${companionName} wants to catch up`
      : companionCount > 1
      ? "Your companions are thinking of you"
      : "Time to unwind with Ally";

  const body =
    period === "midday"
      ? companionName
        ? `Take a quick break — ${companionName} is waiting to chat and catch up.`
        : "Take a pause from your busy day — open Ally to catch up with your characters."
      : companionName
      ? `How was your day? ${companionName} is here to talk and unwind with you tonight.`
      : "End your day with a thoughtful conversation. Your companions are waiting for you.";

  await dispatchNotification({
    title,
    body,
    companionId,
    extra: {
      companionId,
      route: companionId ? `/chat/${companionId}` : "/home",
      isDailyReminder: true,
      period,
    },
  });
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
        data: { companionId, ...extra },
      });
      notif.onclick = () => {
        window.focus();
        const route = (extra?.route as string) || (companionId ? `/chat/${companionId}` : "/home");
        window.location.href = route;
        notif.close();
      };
    } catch (err) {
      console.warn("Web notification failed:", err);
    }
  }
}
