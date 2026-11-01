import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Proactive companion pings cron job.
 * Scans active companions where notify is true, checks for inactivity,
 * and generates in-character pings.
 */
async function handle(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const adminDb = getAdminClient();

  // Find active companions with notifications enabled
  const { data: companions, error: compErr } = await adminDb
    .from("companions")
    .select("id, user_id, template_id")
    .eq("status", "active")
    .eq("notify", true)
    .is("paused_reason", null)
    .limit(20);

  if (compErr || !companions?.length) {
    return NextResponse.json({ processed: 0, pinged: 0 });
  }

  let pingCount = 0;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ally.redream.in";

  for (const c of companions) {
    try {
      const res = await fetch(`${siteUrl}/api/chat/ping`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({
          companionId: c.id,
          inactivityMinutes: 120, // 2 hours of inactivity
        }),
      });

      const data = await res.json();
      if (data.pinged) {
        pingCount++;
      }
    } catch (err) {
      console.error(`Cron ping error for companion ${c.id}:`, err);
    }
  }

  return NextResponse.json({
    processed: companions.length,
    pinged: pingCount,
    timestamp: Date.now(),
  });
}

export const GET = handle;
export const POST = handle;
