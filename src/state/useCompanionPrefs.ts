"use client";

import { useCallback } from "react";
import { useAlly } from "@/state/useAlly";
import { useToast } from "@/state/useToast";
import { setCompanionPrefs } from "@/lib/supabase/queries";
import { COPY } from "@/lib/copy";

/**
 * P2: a companion's notify/sound switches live on its server row, so they
 * survive a reload or a new device. Writes through set_companion_prefs, then
 * dispatches the confirmed values.
 */
export function useCompanionPrefs() {
  const { dispatch } = useAlly();
  const showToast = useToast();

  const setNotify = useCallback(
    (companionId: string, notify: boolean) => {
      setCompanionPrefs(companionId, { notify })
        .then((res) => dispatch({ type: "SET_NOTIFY", companionId, notify: res.notify }))
        .catch(() => showToast(COPY.auth.network));
    },
    [dispatch, showToast]
  );

  const setSound = useCallback(
    (companionId: string, sound: boolean) => {
      setCompanionPrefs(companionId, { sound })
        .then((res) => dispatch({ type: "SET_SOUND", companionId, sound: res.sound }))
        .catch(() => showToast(COPY.auth.network));
    },
    [dispatch, showToast]
  );

  return { setNotify, setSound };
}
