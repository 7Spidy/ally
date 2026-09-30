import { NextResponse } from "next/server";

/**
 * Deterministic xAI stand-in for E2E. 404 unless E2E_MOCKS=1, which Vercel
 * never sets. The app reaches it only because LLM_BASE_URL (read from env,
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
    riskLevel: "none",
    ageClaimUnder18: false,
    disclosure: false,
    mutualVulnerability: false,
    abusive: false,
    ...o,
  };
}

function cannedFor(text: string, system: string) {
  const t = text.toLowerCase();
  // Voice lint: a reply that breaks a rule, then (once told so) a clean one.
  if (t.includes("lint please")) {
    return system.includes("Your last reply broke a rule")
      ? out({ bubbles: [{ text: "my flatmate tanvi is fine now", effect: null }] })
      : out({ bubbles: [{ text: "tanvi says hi", effect: null }] });
  }
  if (t.includes("json please") || t.includes("invalid please") || t.includes("ladder please")) return out({ bubbles: [{ text: "got there in the end", effect: null }] });
  if (t.startsWith("(the chat has just opened")) return out({ bubbles: [{ text: "you look like someone who reads the fine print. what's on your mind?", effect: null }] });
  if (t.includes("my manager moved the deadline again")) return out({ reaction: "👀", bubbles: [{ text: "again. that's the third time you've said that word this week", effect: null }] });
  if (t.includes("ink please")) return out({ bubbles: [{ text: "i don't usually say this out loud", effect: "ink" }] });
  if (t.includes("effect please")) return out({ reaction: "❤️", bubbles: [{ text: "SLAM", effect: "loud" }, { text: "second", effect: "soft" }] });
  if (t.includes("acute please")) return out({ riskLevel: "acute", bubbles: [{ text: "i'm here. tell me where you are right now", effect: "loud" }] });
  if (t.includes("i am 16")) return out({ ageClaimUnder18: true, bubbles: [{ text: "ok", effect: null }] });
  return out({});
}

interface MockBody {
  messages?: Turn[];
  model?: string;
  temperature?: number;
  response_format?: { type?: string };
}

/**
 * The JSON retry ladder, exercised from the client. The ladder's attempts differ
 * in the request: attempt 1 runs at the default temperature, retry 1 at 0.7, and
 * retry 2 asks for response_format json_object.
 */
function ladderFailure(text: string, body: MockBody): "prose" | "invalid" | null {
  const t = text.toLowerCase();
  const isRetry1 = body.temperature === 0.7 && body.response_format?.type !== "json_object";
  const isRetry2 = body.response_format?.type === "json_object";
  if (t.includes("json please")) return isRetry1 || isRetry2 ? null : "prose"; // fails once, retry 1 works
  if (t.includes("invalid please")) return isRetry1 || isRetry2 ? null : "invalid"; // provider 400 once
  if (t.includes("ladder please")) return isRetry2 ? null : "invalid"; // only json_object works
  if (t.includes("dead please")) return "prose"; // never works
  return null;
}

export async function POST(request: Request) {
  if (process.env.E2E_MOCKS !== "1") return new NextResponse(null, { status: 404 });
  const body = (await request.json().catch(() => null)) as MockBody | null;
  const last = [...(body?.messages ?? [])].reverse().find((m) => m.role === "user");
  const system = body?.messages?.find((m) => m.role === "system")?.content ?? "";
  const text = (last?.content ?? "").replace(/^[#d+]s*/, "");
  const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } };
  const failure = ladderFailure(text, body ?? {});
  if (failure === "invalid") {
    return NextResponse.json({ error: { message: "Failed to validate JSON.", type: "invalid_request_error", code: "json_validate_failed", failed_generation: "" } }, { status: 400 });
  }
  const content = failure === "prose" ? "Sure! Here is what I would say, no JSON." : JSON.stringify(cannedFor(text, system));
  return NextResponse.json({ model: body?.model ?? "mock", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage });
}
