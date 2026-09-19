"use client";

import { useContext } from "react";
import { ManifestContext } from "@/state/ManifestProvider";

export function useManifest() {
  return useContext(ManifestContext);
}
