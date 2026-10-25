// Manual eval launcher (B2, generalised in B4). Not part of CI. Runs scripts/eval-persona.ts through
// vite-node, so no new dependency. Flags pass through:
//   node scripts/eval-persona.mjs --persona F02 --only=1,2,18,19 --gap=20 --tag=deepseek-v4-pro
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["vite-node", "--config", "vitest.config.ts", "scripts/eval-persona.ts", "--", ...process.argv.slice(2)], { stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
