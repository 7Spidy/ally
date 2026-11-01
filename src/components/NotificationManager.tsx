"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { active } from "@/lib/selectors";
import { firstNameFromFull } from "@/lib/engine";
import { initNotificationService, dispatchNotification } from "@/lib/notifications";

export function NotificationManager() {
  const router = useRouter();
  const pathname = usePathname();
  const { state, dispatch, ownerId } = useAlly();
  const { templates } = useManifest();
  const activeCompanions = active(state);

  const lastCheckedRef = useRef<number>(Date.now());
  const inFlightRef = useRef(false);

  // Initialize notification click handlers
  useEffect(() => {
    initNotificationService((companionId) => {
      router.push(`/chat/${companionId}`);
    });
  }, [router]);

  // Periodic proactive ping check when NOT in the active companion's chat
  useEffect(() => {
    if (!ownerId && !activeCompanions.length) return;

    async function checkProactivePings() {
      if (inFlightRef.current) return;
      // Don't check if user was active within last 2 minutes
      if (Date.now() - lastCheckedRef.current < 60000) return;
      lastCheckedRef.current = Date.now();

      for (const companion of activeCompanions) {
        // Skip if notifications are disabled for this companion
        if (!companion.notify) continue;

        // Skip if currently inside this companion's chat
        if (pathname === `/chat/${companion.id}`) continue;

        try {
          inFlightRef.current = true;
          const res = await fetch("/api/chat/ping", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companionId: companion.id,
              inactivityMinutes: 30, // 30 minutes of inactivity
            }),
          });

          if (!res.ok) continue;
          const data = await res.json();

          if (data.pinged && data.message) {
            // Update client state with the proactive message
            dispatch({
              type: "RECEIVE_REPLY",
              companionId: companion.id,
              message: {
                id: data.message.id,
                who: "them",
                text: data.message.text,
                at: data.message.at,
                meta: data.message.meta,
              },
            });

            // Find template details for avatar and name
            const template = templates.find((t) => t.id === companion.templateId);
            const companionName = template ? firstNameFromFull(template.name) : (data.companionName || "Companion");
            const avatarUrl = template?.avatar ? `/${template.avatar}` : undefined;

            // Trigger native Android / web notification
            await dispatchNotification({
              title: companionName,
              body: data.message.text,
              companionId: companion.id,
              icon: avatarUrl,
            });
          }
        } catch (err) {
          console.warn("Proactive ping check error:", err);
        } finally {
          inFlightRef.current = false;
        }
      }
    }

    // Check periodically
    const interval = setInterval(checkProactivePings, 60000); // Check every minute
    
    // Also check on tab visibility change
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkProactivePings();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activeCompanions, dispatch, pathname, ownerId, templates]);

  return null;
}
