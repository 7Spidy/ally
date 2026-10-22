import { NextResponse } from "next/server";

/**
 * Deterministic LLM stand-in for E2E. 404 unless E2E_MOCKS=1, which Vercel
 * never sets. The app reaches it only because LLM_BASE_URL (read from env,
 * never from a request) points at /api/test/llm-mock in the test server.
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
  if (t.includes("json please")) return out({ bubbles: [{ text: "got there in the end", effect: null }] });
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
  thinking?: { type?: string };
}

/**
 * The JSON retry ladder, exercised from the client. Attempt 1 runs at the
 * default temperature and retry 1 at 0.7, so "json please" answers in prose
 * once and then recovers; "dead please" never does.
 */
function ladderFailure(text: string, body: MockBody): "prose" | null {
  const t = text.toLowerCase();
  if (t.includes("json please")) return body.temperature === 0.7 ? null : "prose";
  if (t.includes("dead please")) return "prose";
  return null;
}

export async function POST(request: Request) {
  if (process.env.E2E_MOCKS !== "1") return new NextResponse(null, { status: 404 });
  const body = (await request.json().catch(() => null)) as MockBody | null;
  // DeepSeek V4: the client always sends thinking.type; anything but "disabled" is a bug in the client.
  if (body?.thinking?.type !== "disabled" && body?.thinking?.type !== "enabled") {
    return NextResponse.json({ error: { message: "thinking.type is required", type: "invalid_request_error" } }, { status: 400 });
  }
  const last = [...(body?.messages ?? [])].reverse().find((m) => m.role === "user");
  const system = body?.messages?.find((m) => m.role === "system")?.content ?? "";
  const text = (last?.content ?? "").replace(/^[#d+]s*/, "");
  const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } };
  const failure = ladderFailure(text, body ?? {});
  const content = failure === "prose" ? "Sure! Here is what I would say, no JSON." : JSON.stringify(cannedFor(text, system));
  return NextResponse.json({ model: body?.model ?? "mock", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage });
}
