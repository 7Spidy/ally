// Writes .env.test.local from the running local Supabase stack.
// Prerequisite: Docker running and `npm run db:start`.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const raw = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const vars = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m) vars[m[1]] = m[2];
}

const url = vars.API_URL;
const publishable = vars.PUBLISHABLE_KEY || vars.ANON_KEY;
const secret = vars.SECRET_KEY || vars.SERVICE_ROLE_KEY;
if (!url || !publishable || !secret) {
  console.error("Could not read API_URL / PUBLISHABLE_KEY / SECRET_KEY from `supabase status -o env`. Is the local stack running?");
  process.exit(1);
}

const lines = [
  `NEXT_PUBLIC_SUPABASE_URL=${url}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable}`,
  `SUPABASE_SECRET_KEY=${secret}`,
  "NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100",
  "NEXT_PUBLIC_TURNSTILE_BYPASS=1",
  "ALLY_E2E=1",
  `MAIL_URL=${vars.MAILPIT_URL || vars.INBUCKET_URL || "http://127.0.0.1:54324"}`,
  "",
];
writeFileSync(".env.test.local", lines.join("\n"));
console.log("Wrote .env.test.local");
