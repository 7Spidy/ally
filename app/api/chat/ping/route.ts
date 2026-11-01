import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { personaFor } from "@/personas/registry";
import { generateProactivePing } from "@/lib/llm/proactive";
import { firstNameFromFull } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isCronAuthorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    companionId?: unknown;
    force?: unknown;
    inactivityMinutes?: unknown;
  } | null;

  const companionId = typeof body?.companionId === "string" ? body.companionId : "";
  const force = body?.force === true;
  const minInactivityMs = (typeof body?.inactivityMinutes === "number" ? body.inactivityMinutes : 30) * 60 * 1000;

  if (!companionId) {
    return NextResponse.json({ error: "bad_request", message: "companionId required" }, { status: 400 });
  }

  // 1. Authorize: either logged-in user who owns the companion or Cron
  const isCron = isCronAuthorised(request);
  let userId: string | null = null;
  const adminDb = getAdminClient();

  if (!isCron) {
    const supabase = await getServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    userId = user.id;
  }

  // 2. Fetch companion
  const { data: companion, error: compErr } = await adminDb
    .from("companions")
    .select("id, user_id, template_id, status, notify, paused_reason, last_replied_msg")
    .eq("id", companionId)
    .maybeSingle();

  if (compErr || !companion) {
    return NextResponse.json({ error: "not_found", message: "Companion not found" }, { status: 404 });
  }

  // Verify ownership if not cron
  if (!isCron && companion.user_id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Check companion status
  if (companion.status !== "active") {
    return NextResponse.json({ pinged: false, reason: "companion_not_active" });
  }

  if (companion.paused_reason) {
    return NextResponse.json({ pinged: false, reason: "companion_paused" });
  }

  if (!companion.notify && !force) {
    return NextResponse.json({ pinged: false, reason: "notifications_disabled" });
  }

  // 3. Fetch recent messages
  const { data: messagesDesc } = await adminDb
    .from("messages")
    .select("id, who, text, created_at, meta")
    .eq("companion_id", companionId)
    .is("deleted_at", null)
    .order("id", { ascending: false })
    .limit(15);

  const messages = (messagesDesc ?? []).reverse();

  // If no conversation at all yet, wait for opener
  if (messages.length === 0) {
    return NextResponse.json({ pinged: false, reason: "no_messages_yet" });
  }

  const lastMsg = messages[messages.length - 1];
  const lastMsgTime = new Date(lastMsg.created_at).getTime();
  const timeSinceLastMsg = Date.now() - lastMsgTime;

  if (!force) {
    // Check if user or companion was active very recently
    if (timeSinceLastMsg < minInactivityMs) {
      return NextResponse.json({
        pinged: false,
        reason: "too_soon",
        idleMinutes: Math.round(timeSinceLastMsg / 60000),
      });
    }

    // Don't send double proactive pings without user reply in between
    if (lastMsg.who === "them" && (lastMsg.meta as Record<string, unknown> | null)?.proactive === true) {
      return NextResponse.json({ pinged: false, reason: "already_pinged_waiting_for_user" });
    }
  }

  // 4. Fetch user display name
  const { data: profile } = await adminDb
    .from("profiles")
    .select("display_name")
    .eq("id", companion.user_id)
    .maybeSingle();

  const userName = profile?.display_name || "Friend";

  // 5. Load persona and generate message
  let persona;
  try {
    persona = personaFor(companion.template_id);
  } catch {
    // If not in registry, construct fallback persona
    persona = {
      id: companion.template_id,
      name: "Companion",
      city: "India",
      read: "A thoughtful companion",
      occupation: "Creative",
      interests: ["music", "making", "reading"],
    };
  }

  const historyTurns = messages.map((m) => ({
    who: m.who,
    text: m.text,
    at: new Date(m.created_at).getTime(),
  }));

  const { text: pingText } = await generateProactivePing({
    persona: persona as never,
    userName,
    history: historyTurns,
    companionId: companion.id,
  });

  // 6. Write proactive reply into database
  const replyPayload = {
    companionId: companion.id,
    userMessageId: null,
    bubbles: [
      {
        text: pingText,
        meta: { proactive: true },
      },
    ],
    reaction: null,
  };

  const { data: written, error: writeErr } = await adminDb.rpc("write_live_reply", {
    p: replyPayload,
  });

  if (writeErr) {
    console.error("Failed to write proactive ping reply:", writeErr);
    return NextResponse.json({ error: "db_error", message: writeErr.message }, { status: 500 });
  }

  const bubbles = (written as { bubbles?: { id: number; text: string; at: number; meta: Record<string, unknown> }[] })?.bubbles ?? [];
  const createdMsg = bubbles[0] || {
    id: Date.now(),
    text: pingText,
    at: Date.now(),
    meta: { proactive: true },
  };

  return NextResponse.json({
    pinged: true,
    companionName: firstNameFromFull(persona.name),
    templateId: companion.template_id,
    message: {
      id: createdMsg.id,
      who: "them",
      text: createdMsg.text,
      at: createdMsg.at,
      meta: { proactive: true },
    },
  });
}
