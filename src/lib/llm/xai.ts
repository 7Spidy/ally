/**
 * LLM client (D2): OpenAI-compatible Chat Completions over fetch, no SDK.
 * Written for xAI, but the request shape is per-provider configurable so
 * Groq and others work with no code change:
 *   XAI_BASE_URL, XAI_MODEL, XAI_API_KEY   endpoint, model, key
 *   LLM_RESPONSE_FORMAT   json_schema (default) | json_object
 *   LLM_MAX_TOKENS_PARAM  max_tokens (default) | max_completion_tokens
 *   LLM_MAX_TOKENS        overrides the caller's cap (reasoning models spend it on thinking)
 *   LLM_REASONING_EFFORT  low | medium | high, sent as reasoning_effort when set
 *   LLM_STRICT            false sends json_schema with strict:false
 * Env is read inside chat(), never at import time, so `next build` works
 * with no variables set. Logs model, token counts, latency and companion id;
 * never message text.
 */

export const DEFAULT_MODEL = "grok-4.20-0309-non-reasoning";
export const DEFAULT_BASE_URL = "https://api.x.ai/v1";
export const TIMEOUT_MS = 25000;
const BODY_LIMIT = 600;

export interface ChatArgs {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** A JSON Schema for a structured response (sent as json_schema, or described in the prompt for json_object). */
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

export class XaiError extends Error {
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
  strict: boolean;
  reasoningEffort: string | null;
  maxTokens: number | null;
}

/** The request shape for the configured provider. */
export function requestShape(): RequestShape {
  return {
    responseFormat: process.env.LLM_RESPONSE_FORMAT === "json_object" ? "json_object" : "json_schema",
    maxTokensParam: process.env.LLM_MAX_TOKENS_PARAM === "max_completion_tokens" ? "max_completion_tokens" : "max_tokens",
    strict: process.env.LLM_STRICT !== "false",
    reasoningEffort: process.env.LLM_REASONING_EFFORT || null,
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
    temperature: args.temperature ?? 0.9,
  };
  if (shape.maxTokensParam !== "omit") body[shape.maxTokensParam] = shape.maxTokens ?? args.maxTokens ?? 500;
  if (shape.reasoningEffort) body.reasoning_effort = shape.reasoningEffort;
  if (args.schema && shape.responseFormat === "json_schema") {
    body.response_format = { type: "json_schema", json_schema: { name: args.schemaName ?? "reply", strict: shape.strict, schema: args.schema } };
  } else if (args.schema && shape.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }
  return body;
}

async function once(args: ChatArgs): Promise<ChatResult> {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new XaiError("XAI_API_KEY is not set", null, false);
  const base = (process.env.XAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = process.env.XAI_MODEL || DEFAULT_MODEL;
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
    throw new XaiError(aborted ? "timeout" : "network", null, true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim().slice(0, BODY_LIMIT);
    throw new XaiError(`xai_http_${res.status}`, res.status, res.status >= 500, text || null, retryAfter(res));
  }

  const json = (await res.json().catch(() => null)) as Completion | null;
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new XaiError("xai_empty", res.status, false);

  const result: ChatResult = {
    content,
    model: json?.model ?? model,
    usage: {
      input: json?.usage?.prompt_tokens ?? 0,
      output: json?.usage?.completion_tokens ?? 0,
      cached: json?.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
    latencyMs: Date.now() - started,
  };
  console.info(
    JSON.stringify({ evt: "xai.chat", model: result.model, input: result.usage.input, output: result.usage.output, cached: result.usage.cached, ms: result.latencyMs, companion: args.companionId ?? null })
  );
  return result;
}

/** One call, one retry on a 5xx or a timeout. */
export async function chat(args: ChatArgs): Promise<ChatResult> {
  try {
    return await once(args);
  } catch (e) {
    if (e instanceof XaiError && e.retryable) return once(args);
    throw e;
  }
}

/** GET {base}/models: the ids the provider offers this key. */
export async function listModels(): Promise<string[]> {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new XaiError("XAI_API_KEY is not set", null, false);
  const base = (process.env.XAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new XaiError(`xai_http_${res.status}`, res.status, false, (await res.text().catch(() => "")).trim().slice(0, BODY_LIMIT) || null);
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id).sort();
}
