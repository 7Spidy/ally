"use client";

import { useEffect, useState } from "react";
import { useAlly } from "@/state/useAlly";

/**
 * P2: holds back page content until AllyProvider is first `ready`, i.e. the
 * server state (get_my_state) has landed for the current user. Before P2
 * hydration was synchronous, so screens could read state on their first
 * render; now a screen loaded directly (home, a chat, an onboarding step)
 * would otherwise render, and let the user act on, the empty placeholder
 * for a network round trip. Renders nothing meanwhile (no spinner, spec
 * §13.2), which is also identical on the server and the first client pass.
 *
 * Sticky: once open it stays open, so a later identity change (consent's
 * anonymous sign-in, a login) never unmounts the screen mid-action.
 */
export function AllyGate({ children }: { children: React.ReactNode }) {
  const { ready } = useAlly();
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (ready) setOpened(true);
  }, [ready]);
  return ready || opened ? <>{children}</> : null;
}
