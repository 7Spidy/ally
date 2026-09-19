"use client";

import { createContext, useEffect, useState } from "react";
import type { Manifest, Template } from "@/lib/engine";

export interface ManifestContextValue {
  status: "loading" | "ready" | "error";
  templates: Template[];
  interestVocabulary: Record<string, string>;
}

export const ManifestContext = createContext<ManifestContextValue>({
  status: "loading",
  templates: [],
  interestVocabulary: {},
});

/**
 * Fetches assets/manifest.json once at boot. Per spec §3: no fallback to
 * embedded data — a fetch failure is a hard stop, rendered by the
 * consuming screen (see useManifest / ManifestGate).
 */
export function ManifestProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<ManifestContextValue>({ status: "loading", templates: [], interestVocabulary: {} });

  useEffect(() => {
    let cancelled = false;
    fetch("/assets/manifest.json")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<Manifest>;
      })
      .then((m) => {
        if (cancelled) return;
        setValue({ status: "ready", templates: m.templates, interestVocabulary: m.interest_vocabulary });
      })
      .catch(() => {
        if (cancelled) return;
        setValue((v) => ({ ...v, status: "error" }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <ManifestContext.Provider value={value}>{children}</ManifestContext.Provider>;
}
