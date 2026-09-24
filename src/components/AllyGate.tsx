"use client";

import { useEffect, useState } from "react";
import { useAlly } from "@/state/useAlly";
import { COPY } from "@/lib/copy";

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
 *
 * If the server load fails, the provider keeps retrying; meanwhile this
 * shows the network line (same one-line style as ManifestGate's error)
 * instead of a blank screen. The screen appears as soon as a retry lands.
 */
export function AllyGate({ children }: { children: React.ReactNode }) {
  const { ready, loadFailed } = useAlly();
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (ready) setOpened(true);
  }, [ready]);
  if (ready || opened) return <>{children}</>;
  if (loadFailed) {
    return (
      <div role="alert" style={{ padding: 24, color: "var(--mut)" }}>
        {COPY.auth.network}
      </div>
    );
  }
  return null;
}
