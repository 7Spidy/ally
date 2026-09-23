import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// .env.test.local is written by `npm run e2e:env` from the local Supabase
// stack. Load it into this process (so the test workers and helpers see it)
// and hand it to the web server build/start below.
function loadEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const testEnv = loadEnv(path.resolve(__dirname, ".env.test.local"));
for (const [k, v] of Object.entries(testEnv)) if (process.env[k] === undefined) process.env[k] = v;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // Every test now signs in against the local Supabase stack; more workers
  // than this starve the machine (browser sessions crash under load).
  workers: process.env.CI ? 1 : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
    viewport: { width: 390, height: 844 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], hasTouch: true, isMobile: true },
    },
  ],
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
    env: {
      ...testEnv,
      ALLY_E2E: "1",
      NEXT_PUBLIC_TURNSTILE_BYPASS: "1",
    },
  },
});
