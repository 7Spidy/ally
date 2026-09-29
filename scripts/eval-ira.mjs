// Manual eval launcher (B2). Not part of CI. Runs scripts/eval-ira.ts through
// vite-node (already installed with vitest, so no new dependency) with the
// project's "@" alias, then writes docs/evals/ira-<date>.md.
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["vite-node", "--config", "vitest.config.ts", "scripts/eval-ira.ts"], { stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
