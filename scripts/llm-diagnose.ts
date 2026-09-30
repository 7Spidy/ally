/**
 * Provider diagnostics (manual, not CI): lists the models the key can use,
 * measures one compiled L3 prompt, and walks the request shape one change at
 * a time, printing each provider error body. Never prints the key.
 *
 *   npm run llm:diagnose -- --model=openai/gpt-oss-120b
 */
import { compile } from "@/lib/llm/compile";
import { LIVE_OUT_SCHEMA } from "@/lib/llm/contract";
import { buildBody, listModels, llmEnv, XaiError, type RequestShape } from "@/lib/llm/xai";
import * as heart from "@/lib/heart";
import { FIXED_CREATED, FIXED_NOW, loadEnvLocal } from "./_env";

loadEnvLocal();

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

function l3Prompt() {
  const h = heart.now({ id: "c_eval", createdAt: FIXED_CREATED }, FIXED_NOW);
  return compile({
    level: 3,
    mode: "reply",
    userName: "Riya",
    heart: h,
    milestone: null,
    facts: [{ id: 1, category: "work", fact: "Works in marketing; has a strict manager" }],
    weekSummaries: [],
    daySummaries: [],
    history: [
      { id: 1, who: "them", text: "you look like someone who reads the fine print" },
      { id: 2, who: "me", text: "rough day. everything went wrong at work" },
    ],
    coolOff: false,
    safetyMode: false,
    lowEffort: false,
  });
}

async function attempt(label: string, model: string, shape: Partial<RequestShape>, withSchema: boolean) {
  const c = l3Prompt();
  const base = (llmEnv("BASE_URL") || "").replace(/\/+$/, "");
  const body = buildBody({ system: c.system, messages: c.messages, schema: withSchema ? LIVE_OUT_SCHEMA : undefined, schemaName: "ira_reply", shape }, model);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${llmEnv("API_KEY")}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.log(`${label}: HTTP ${res.status}  retry-after=${res.headers.get("retry-after") ?? "-"}\n  body: ${text.trim().slice(0, 600)}`);
    return { ok: false as const, status: res.status };
  }
  const json = JSON.parse(text) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: Record<string, unknown> };
  const content = json.choices?.[0]?.message?.content ?? "";
  console.log(`${label}: OK  finish=${json.choices?.[0]?.finish_reason}  usage=${JSON.stringify(json.usage)}\n  content: ${content.slice(0, 160).replace(/\s+/g, " ")}`);
  return { ok: true as const, status: 200, usage: json.usage };
}

async function main() {
  if (!llmEnv("API_KEY") || !llmEnv("BASE_URL")) {
    console.error("LLM_API_KEY and LLM_BASE_URL must be set (env or .env.local).");
    process.exit(1);
  }
  console.log(`Provider: ${new URL(llmEnv("BASE_URL")!).host}`);

  try {
    const ids = await listModels();
    console.log(`\nAvailable models (${ids.length}):`);
    for (const id of ids) console.log(`  ${id}`);
  } catch (e) {
    console.log(`models: ${(e as XaiError).message}`);
  }

  const c = l3Prompt();
  const chars = c.system.length + c.messages.reduce((n, m) => n + m.content.length, 0);
  console.log(`\nCompiled L3 prompt: ${c.system.length} system chars + ${chars - c.system.length} history chars = ${chars} chars (about ${Math.round(chars / 4)} tokens at 4 chars/token; the provider's own count follows below).`);

  const model = arg("model");
  if (!model) return;
  console.log(`\nDiagnosing request shape on ${model}, one change at a time:`);
  const gap = Number(arg("gap") ?? 5) * 1000;
  const steps: [string, Partial<RequestShape>, boolean][] = [
    ["(a) bare request, no token cap, no response_format", { maxTokensParam: "omit", responseFormat: "none" }, false],
    ["(b1) + max_tokens", { maxTokensParam: "max_tokens", responseFormat: "none" }, false],
    ["(b2) + max_completion_tokens", { maxTokensParam: "max_completion_tokens", responseFormat: "none" }, false],
    ["(c) + json_schema strict:true", { maxTokensParam: "max_completion_tokens", responseFormat: "json_schema", strict: true }, true],
    ["(c2) same, cap raised to 2000 (reasoning tokens count toward it)", { maxTokensParam: "max_completion_tokens", responseFormat: "json_schema", strict: true, maxTokens: 2000 }, true],
    ["(c3) same, cap 2000 + reasoning_effort low", { maxTokensParam: "max_completion_tokens", responseFormat: "json_schema", strict: true, maxTokens: 2000, reasoningEffort: "low" }, true],
    ["(d) json_schema strict:false", { maxTokensParam: "max_completion_tokens", responseFormat: "json_schema", strict: false, maxTokens: 2000, reasoningEffort: "low" }, true],
    ["(e) json_object, schema described in the prompt", { maxTokensParam: "max_completion_tokens", responseFormat: "json_object", maxTokens: 2000, reasoningEffort: "low" }, true],
  ];
  for (const [label, shape, withSchema] of steps) {
    let r = await attempt(label, model, shape, withSchema);
    for (let i = 0; !r.ok && r.status === 429 && i < 3; i++) {
      await new Promise((res) => setTimeout(res, 30000));
      r = await attempt(`${label} (retry ${i + 1})`, model, shape, withSchema);
    }
    await new Promise((res) => setTimeout(res, gap));
  }
}

void main();
