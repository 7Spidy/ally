import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBody, chat, listModels, requestShape, XaiError } from "@/lib/llm/xai";

const ENV_KEYS = ["XAI_API_KEY", "XAI_BASE_URL", "XAI_MODEL", "LLM_RESPONSE_FORMAT", "LLM_MAX_TOKENS_PARAM", "LLM_MAX_TOKENS", "LLM_REASONING_EFFORT", "LLM_STRICT"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.XAI_API_KEY = "test-key-not-real";
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const SCHEMA = { type: "object", properties: { a: { type: "string" } } };
const args = { system: "sys", messages: [{ role: "user" as const, content: "hi" }], schema: SCHEMA, schemaName: "s" };

function fakeFetch(res: { status: number; body: unknown; headers?: Record<string, string> }, seen: { url?: string; body?: Record<string, unknown> }[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    const text = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
    return new Response(text, { status: res.status, headers: res.headers });
  }) as unknown as typeof fetch;
}

describe("request shape (per provider, from env)", () => {
  it("defaults to xAI: json_schema strict, max_tokens", () => {
    const b = buildBody(args, "m") as { max_tokens: number; response_format: { type: string; json_schema: { strict: boolean } } };
    expect(b.max_tokens).toBe(500);
    expect(b.response_format.type).toBe("json_schema");
    expect(b.response_format.json_schema.strict).toBe(true);
    expect(requestShape()).toMatchObject({ responseFormat: "json_schema", maxTokensParam: "max_tokens" });
  });

  it("LLM_RESPONSE_FORMAT=json_object sends json_object and no schema", () => {
    process.env.LLM_RESPONSE_FORMAT = "json_object";
    const b = buildBody(args, "m") as { response_format: Record<string, unknown> };
    expect(b.response_format).toEqual({ type: "json_object" });
  });

  it("LLM_MAX_TOKENS_PARAM, LLM_MAX_TOKENS and LLM_REASONING_EFFORT reach the body", () => {
    process.env.LLM_MAX_TOKENS_PARAM = "max_completion_tokens";
    process.env.LLM_MAX_TOKENS = "2000";
    process.env.LLM_REASONING_EFFORT = "low";
    const b = buildBody({ ...args, maxTokens: 500 }, "m");
    expect(b.max_completion_tokens).toBe(2000);
    expect(b).not.toHaveProperty("max_tokens");
    expect(b.reasoning_effort).toBe("low");
  });

  it("LLM_STRICT=false sends strict:false", () => {
    process.env.LLM_STRICT = "false";
    const b = buildBody(args, "m") as { response_format: { json_schema: { strict: boolean } } };
    expect(b.response_format.json_schema.strict).toBe(false);
  });

  it("no schema means no response_format", () => {
    expect(buildBody({ ...args, schema: undefined }, "m")).not.toHaveProperty("response_format");
  });
});

describe("errors carry the provider's body", () => {
  it("puts the response body in the thrown error and never the key", async () => {
    const body = { error: { message: "Failed to validate JSON.", code: "json_validate_failed" } };
    const err = await chat({ ...args, fetchImpl: fakeFetch({ status: 400, body }) }).catch((e) => e);
    expect(err).toBeInstanceOf(XaiError);
    expect(err.status).toBe(400);
    expect(err.message).toContain("xai_http_400");
    expect(err.message).toContain("json_validate_failed");
    expect(err.body).toContain("Failed to validate JSON");
    expect(JSON.stringify(err.message)).not.toContain("test-key-not-real");
  });

  it("reads Retry-After on a 429, in seconds or as a date", async () => {
    const e1 = await chat({ ...args, fetchImpl: fakeFetch({ status: 429, body: "slow down", headers: { "retry-after": "9" } }) }).catch((e) => e);
    expect(e1.status).toBe(429);
    expect(e1.retryAfterMs).toBe(9000);
    expect(e1.retryable).toBe(false);
    const e2 = await chat({ ...args, fetchImpl: fakeFetch({ status: 429, body: "x" }) }).catch((e) => e);
    expect(e2.retryAfterMs).toBeNull();
  });

  it("retries a 5xx once, then throws with the body", async () => {
    const seen: { url?: string }[] = [];
    const err = await chat({ ...args, fetchImpl: fakeFetch({ status: 503, body: "upstream down" }, seen) }).catch((e) => e);
    expect(seen).toHaveLength(2);
    expect(err.message).toContain("upstream down");
  });

  it("truncates a huge error body", async () => {
    const err = await chat({ ...args, fetchImpl: fakeFetch({ status: 400, body: "x".repeat(5000) }) }).catch((e) => e);
    expect(err.body.length).toBeLessThanOrEqual(600);
  });
});

describe("success and models", () => {
  it("returns content and usage, and posts to {base}/chat/completions", async () => {
    process.env.XAI_BASE_URL = "https://api.groq.com/openai/v1/";
    const seen: { url?: string; body?: Record<string, unknown> }[] = [];
    const res = await chat({
      ...args,
      fetchImpl: fakeFetch({ status: 200, body: { model: "m", choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 7, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 2 } } } }, seen),
    });
    expect(seen[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(res).toMatchObject({ content: "{}", usage: { input: 7, output: 3, cached: 2 } });
  });

  it("fails clearly without a key", async () => {
    delete process.env.XAI_API_KEY;
    await expect(chat({ ...args })).rejects.toThrow("XAI_API_KEY is not set");
    await expect(listModels()).rejects.toThrow("XAI_API_KEY is not set");
  });
});
