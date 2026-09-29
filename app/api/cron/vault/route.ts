import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { chat } from "@/lib/llm/xai";
import { runDaily, runWeekly } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Vault cron entry (spec 4.9). Supabase pg_cron posts here with
 * `Authorization: Bearer ${CRON_SECRET}`; anything else gets 401 and no work.
 * Each call handles up to 25 companions and reports what is left, so the
 * repeated cron slots drain the queue.
 */
async function handle(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const job = new URL(request.url).searchParams.get("job");
  if (job !== "daily" && job !== "weekly") return NextResponse.json({ error: "bad_job" }, { status: 400 });
  try {
    const db = getAdminClient();
    const result = job === "daily" ? await runDaily(db, chat, Date.now()) : await runWeekly(db, chat, Date.now());
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "job_failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
