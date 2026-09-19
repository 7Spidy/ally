"use client";

import { useContext } from "react";
import { AllyContext } from "@/state/AllyProvider";

export function useAlly() {
  const ctx = useContext(AllyContext);
  if (!ctx) throw new Error("useAlly must be used within AllyProvider");
  return ctx;
}
