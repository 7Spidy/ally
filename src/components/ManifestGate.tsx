"use client";

import { useManifest } from "@/state/useManifest";

/**
 * Wrap any screen that needs `templates`. Spec §3: on fetch failure, show
 * one line and stop — no fallback to embedded data, no spinner for the
 * loading state either (it resolves in well under a frame in practice;
 * screens that preload deck images handle their own placeholders).
 */
export function ManifestGate({ children }: { children: React.ReactNode }) {
  const { status } = useManifest();
  if (status === "error") {
    return (
      <div style={{ padding: 24, color: "var(--mut)" }}>
        Assets not found. Run this from a local server, not file://
      </div>
    );
  }
  if (status === "loading") return null;
  return <>{children}</>;
}
