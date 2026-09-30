// Manual eval launcher (B2). Not part of CI. Runs scripts/eval-ira.ts through
// vite-node, so no new dependency. Flags pass through:
//   node scripts/eval-ira.mjs --only=1,2,18,19 --gap=20 --tag=gpt-oss
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["vite-node", "--config", "vitest.config.ts", "scripts/eval-ira.ts", "--", ...process.argv.slice(2)], { stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
