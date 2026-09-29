/**
 * xAI client (D2): OpenAI-compatible Chat Completions over fetch, no SDK.
 * Env is read inside chat(), never at import time, so `next build` works
 * with no variables set. Logs model, token counts, latency and companion id;
 * never message text.
 */

export const DEFAULT_MODEL = "grok-4.20-0309-non-reasoning";
export const DEFAULT_BASE_URL = "https://api.x.ai/v1";
export const TIMEOUT_MS = 25000;

export interface ChatArgs {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** A JSON Schema for a strict structured response. */
  schema?: object;
  schemaName?: string;
  maxTokens?: number;
  temperature?: number;
  /** For the log line only. */
  companionId?: string;
  fetchImpl?: typeof fetch;
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
    readonly retryable: boolean
  ) {
    super(message);
  }
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

async function once(args: ChatArgs): Promise<ChatResult> {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new XaiError("XAI_API_KEY is not set", null, false);
  const base = (process.env.XAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = process.env.XAI_MODEL || DEFAULT_MODEL;
  const doFetch = args.fetchImpl ?? fetch;

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: args.system }, ...args.messages],
    max_tokens: args.maxTokens ?? 500,
    temperature: args.temperature ?? 0.9,
  };
  if (args.schema) {
    body.response_format = { type: "json_schema", json_schema: { name: args.schemaName ?? "reply", strict: true, schema: args.schema } };
  }

  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await doFetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (e) {
    const aborted = (e as { name?: string })?.name === "AbortError";
    throw new XaiError(aborted ? "timeout" : "network", null, true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new XaiError(`xai_http_${res.status}`, res.status, res.status >= 500);

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
