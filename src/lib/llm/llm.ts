/**
 * LLM client (D2): OpenAI-compatible Chat Completions over fetch, no SDK.
 * Built for DeepSeek V4 Pro; the endpoint and model come from env:
 *   LLM_API_KEY, LLM_BASE_URL, LLM_MODEL   key, endpoint, model
 *     (unset, the endpoint and model default to DeepSeek V4 Pro)
 *   LLM_THINKING          disabled (default) | enabled, always sent as thinking.type.
 *                         V4 thinks by default; when on, the next request must echo
 *                         reasoning_content and reasoning tokens count against max_tokens.
 *   LLM_RESPONSE_FORMAT   json_object (default) | json_schema
 *   LLM_MAX_TOKENS_PARAM  max_tokens (default) | max_completion_tokens
 *   LLM_MAX_TOKENS        overrides the caller's cap
 * Env is read inside chat(), never at import time, so `next build` works
 * with no variables set. Logs model, token counts, latency and companion id;
 * never message text.
 */

/** LLM_<name>, or undefined when unset or empty. */
export function llmEnv(name: "API_KEY" | "BASE_URL" | "MODEL"): string | undefined {
  return process.env[`LLM_${name}`] || undefined;
}

export const DEFAULT_MODEL = "deepseek-v4-pro";
export const DEFAULT_BASE_URL = "https://api.deepseek.com";
export const TIMEOUT_MS = 25000;
const BODY_LIMIT = 600;

export interface ChatArgs {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** A JSON Schema for a structured response (sent as json_schema, or described in the prompt for json_object; the prompt must say "json"). */
  schema?: object;
  schemaName?: string;
  maxTokens?: number;
  temperature?: number;
  /** For the log line only. */
  companionId?: string;
  fetchImpl?: typeof fetch;
  /** Overrides the env-derived request shape (diagnostics and tests). */
  shape?: Partial<RequestShape>;
}

export interface ChatResult {
  content: string;
  model: string;
  usage: { input: number; output: number; cached: number };
  latencyMs: number;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    /** The provider's error response body, truncated. It never holds our key or the messages we sent. */
    readonly body: string | null = null,
    /** From a Retry-After header, in milliseconds. */
    readonly retryAfterMs: number | null = null
  ) {
    super(body ? `${message}: ${body}` : message);
  }
}

export type ResponseFormatMode = "json_schema" | "json_object" | "none";
export type MaxTokensParam = "max_tokens" | "max_completion_tokens";

export interface RequestShape {
  responseFormat: ResponseFormatMode;
  maxTokensParam: MaxTokensParam | "omit";
  thinking: "disabled" | "enabled";
  maxTokens: number | null;
}

/** The request shape for the configured provider. */
export function requestShape(): RequestShape {
  return {
    responseFormat: process.env.LLM_RESPONSE_FORMAT === "json_schema" ? "json_schema" : "json_object",
    maxTokensParam: process.env.LLM_MAX_TOKENS_PARAM === "max_completion_tokens" ? "max_completion_tokens" : "max_tokens",
    thinking: process.env.LLM_THINKING === "enabled" ? "enabled" : "disabled",
    maxTokens: Number(process.env.LLM_MAX_TOKENS) || null,
  };
}

interface Completion {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    prompt_cache_hit_tokens?: number;
  };
}

function retryAfter(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/** Builds the JSON body of a chat completion request (exported for the diagnostics and tests). */
export function buildBody(args: ChatArgs, model: string): Record<string, unknown> {
  const shape = { ...requestShape(), ...args.shape };
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: args.system }, ...args.messages],
    temperature: args.temperature ?? 0.8,
    thinking: { type: shape.thinking },
  };
  if (shape.maxTokensParam !== "omit") body[shape.maxTokensParam] = shape.maxTokens ?? args.maxTokens ?? 500;
  if (args.schema && shape.responseFormat === "json_schema") {
    body.response_format = { type: "json_schema", json_schema: { name: args.schemaName ?? "reply", strict: true, schema: args.schema } };
  } else if (args.schema && shape.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }
  return body;
}

async function once(args: ChatArgs): Promise<ChatResult> {
  const key = llmEnv("API_KEY");
  if (!key) throw new LlmError("LLM_API_KEY is not set", null, false);
  const base = (llmEnv("BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = llmEnv("MODEL") || DEFAULT_MODEL;
  const doFetch = args.fetchImpl ?? fetch;

  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await doFetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(buildBody(args, model)),
      signal: ctl.signal,
    });
  } catch (e) {
    const aborted = (e as { name?: string })?.name === "AbortError";
    throw new LlmError(aborted ? "timeout" : "network", null, true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim().slice(0, BODY_LIMIT);
    throw new LlmError(`llm_http_${res.status}`, res.status, res.status >= 500, text || null, retryAfter(res));
  }

  const json = (await res.json().catch(() => null)) as Completion | null;
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new LlmError("llm_empty", res.status, false);

  const result: ChatResult = {
    content,
    model: json?.model ?? model,
    usage: {
      input: json?.usage?.prompt_tokens ?? 0,
      output: json?.usage?.completion_tokens ?? 0,
      cached: json?.usage?.prompt_tokens_details?.cached_tokens ?? json?.usage?.prompt_cache_hit_tokens ?? 0,
    },
    latencyMs: Date.now() - started,
  };
  console.info(
    JSON.stringify({ evt: "llm.chat", model: result.model, input: result.usage.input, output: result.usage.output, cached: result.usage.cached, ms: result.latencyMs, companion: args.companionId ?? null })
  );
  return result;
}

/** One call, one retry on a 5xx or a timeout. */
export async function chat(args: ChatArgs): Promise<ChatResult> {
  try {
    return await once(args);
  } catch (e) {
    if (e instanceof LlmError && e.retryable) return once(args);
    throw e;
  }
}

/** GET {base}/models: the ids the provider offers this key. */
export async function listModels(): Promise<string[]> {
  const key = llmEnv("API_KEY");
  if (!key) throw new LlmError("LLM_API_KEY is not set", null, false);
  const base = (llmEnv("BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new LlmError(`llm_http_${res.status}`, res.status, false, (await res.text().catch(() => "")).trim().slice(0, BODY_LIMIT) || null);
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id).sort();
}
