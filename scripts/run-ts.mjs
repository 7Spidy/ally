// Runs a TypeScript script through vite-node (installed with vitest, so no new
// dependency) with the project's "@" alias. Extra arguments are passed on.
//   node scripts/run-ts.mjs scripts/llm-diagnose.ts --model=...
import { spawnSync } from "node:child_process";

const [script, ...rest] = process.argv.slice(2);
const r = spawnSync("npx", ["vite-node", "--config", "vitest.config.ts", script, "--", ...rest], { stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
