import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Loads .env.local into process.env for the manual scripts, without
 * overriding what the shell already set. Values are never printed.
 */
export function loadEnvLocal(): void {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

/** Shared L3 prompt for the diagnostics and the eval, at a fixed clock. */
export const FIXED_NOW = Date.UTC(2026, 4, 12, 15, 30); // Tue 2026-05-12, 21:00 IST
export const FIXED_CREATED = FIXED_NOW - 70 * 86400000;
