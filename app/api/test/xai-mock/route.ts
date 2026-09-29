import { NextResponse } from "next/server";

/**
 * Deterministic xAI stand-in for E2E. 404 unless E2E_MOCKS=1, which Vercel
 * never sets. The app reaches it only because XAI_BASE_URL (read from env,
 * never from a request) points at /api/test/xai-mock in the test server.
 * Canned LiveOut objects are keyed by the user's text.
 */

interface Turn {
  role: string;
  content: string;
}

function out(o: Record<string, unknown>) {
  return {
    reaction: null,
    quoteId: null,
    bubbles: [{ text: "noted.", effect: null }],
    screen: null,
    safety: "none",
    ageClaimUnder18: false,
    disclosure: false,
    mutualVulnerability: false,
    abusive: false,
    ...o,
  };
}

function cannedFor(text: string) {
  const t = text.toLowerCase();
  if (t.startsWith("(the chat has just opened")) return out({ bubbles: [{ text: "you look like someone who reads the fine print. what's on your mind?", effect: null }] });
  if (t.includes("my manager moved the deadline again")) return out({ reaction: "👀", bubbles: [{ text: "again. that's the third time you've said that word this week", effect: null }] });
  if (t.includes("ink please")) return out({ bubbles: [{ text: "i don't usually say this out loud", effect: "ink" }] });
  if (t.includes("effect please")) return out({ reaction: "❤️", bubbles: [{ text: "SLAM", effect: "loud" }, { text: "second", effect: "soft" }] });
  if (t.includes("acute please")) return out({ safety: "acute", bubbles: [{ text: "i'm here. tell me where you are right now", effect: "loud" }] });
  if (t.includes("i am 16")) return out({ ageClaimUnder18: true, bubbles: [{ text: "ok", effect: null }] });
  return out({});
}

export async function POST(request: Request) {
  if (process.env.E2E_MOCKS !== "1") return new NextResponse(null, { status: 404 });
  const body = (await request.json().catch(() => null)) as { messages?: Turn[]; model?: string } | null;
  const last = [...(body?.messages ?? [])].reverse().find((m) => m.role === "user");
  const text = (last?.content ?? "").replace(/^\[#\d+\]\s*/, "");
  return NextResponse.json({
    model: body?.model ?? "mock",
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(cannedFor(text)) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
  });
}
