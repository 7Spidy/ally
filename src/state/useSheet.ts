"use client";

import { useContext } from "react";
import { SheetContext } from "@/state/SheetProvider";

export function useSheet() {
  const ctx = useContext(SheetContext);
  if (!ctx) throw new Error("useSheet must be used within SheetProvider");
  return ctx;
}
