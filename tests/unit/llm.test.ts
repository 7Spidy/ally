import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, buildBody, chat, listModels, requestShape, LlmError } from "@/lib/llm/llm";

const ENV_KEYS = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_RESPONSE_FORMAT", "LLM_MAX_TOKENS_PARAM", "LLM_MAX_TOKENS", "LLM_THINKING"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.LLM_API_KEY = "test-key-not-real";
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

describe("request shape (DeepSeek V4 Pro defaults, env overrides)", () => {
  it("defaults to json_object, max_tokens and thinking disabled", () => {
    const b = buildBody(args, "m") as { max_tokens: number; thinking: { type: string }; response_format: { type: string } };
    expect(b.max_tokens).toBe(500);
    expect(b.response_format).toEqual({ type: "json_object" });
    expect(b.thinking).toEqual({ type: "disabled" });
    expect(requestShape()).toMatchObject({ responseFormat: "json_object", maxTokensParam: "max_tokens", thinking: "disabled" });
  });

  it("always sends thinking, and LLM_THINKING=enabled flips it", () => {
    expect(buildBody({ ...args, schema: undefined }, "m").thinking).toEqual({ type: "disabled" });
    process.env.LLM_THINKING = "enabled";
    expect(buildBody(args, "m").thinking).toEqual({ type: "enabled" });
    process.env.LLM_THINKING = "bogus";
    expect(buildBody(args, "m").thinking).toEqual({ type: "disabled" });
  });

  it("json_schema is reachable only through LLM_RESPONSE_FORMAT=json_schema", () => {
    process.env.LLM_RESPONSE_FORMAT = "json_schema";
    const b = buildBody(args, "m") as { response_format: { type: string; json_schema: { strict: boolean } } };
    expect(b.response_format.type).toBe("json_schema");
    expect(b.response_format.json_schema.strict).toBe(true);
  });

  it("LLM_MAX_TOKENS_PARAM and LLM_MAX_TOKENS reach the body, and reasoning_effort is never sent", () => {
    process.env.LLM_MAX_TOKENS_PARAM = "max_completion_tokens";
    process.env.LLM_MAX_TOKENS = "2000";
    process.env.LLM_REASONING_EFFORT = "low";
    const b = buildBody({ ...args, maxTokens: 500 }, "m");
    expect(b.max_completion_tokens).toBe(2000);
    expect(b).not.toHaveProperty("max_tokens");
    expect(b).not.toHaveProperty("reasoning_effort");
    delete process.env.LLM_REASONING_EFFORT;
  });

  it("no schema means no response_format", () => {
    expect(buildBody({ ...args, schema: undefined }, "m")).not.toHaveProperty("response_format");
  });
});

describe("errors carry the provider's body", () => {
  it("puts the response body in the thrown error and never the key", async () => {
    const body = { error: { message: "Invalid request body.", code: "invalid_request_error" } };
    const err = await chat({ ...args, fetchImpl: fakeFetch({ status: 400, body }) }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.status).toBe(400);
    expect(err.message).toContain("llm_http_400");
    expect(err.message).toContain("invalid_request_error");
    expect(err.body).toContain("Invalid request body");
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

describe("env names and defaults", () => {
  it("defaults to DeepSeek V4 Pro, and reads only LLM_* (XAI_* is ignored)", async () => {
    const seen: { url?: string; body?: Record<string, unknown> }[] = [];
    const ok = { status: 200, body: { choices: [{ message: { content: "{}" } }] } };
    expect(DEFAULT_BASE_URL).toBe("https://api.deepseek.com");
    expect(DEFAULT_MODEL).toBe("deepseek-v4-pro");
    process.env.XAI_BASE_URL = "https://legacy.example/v1";
    process.env.XAI_MODEL = "legacy-model";
    await chat({ ...args, fetchImpl: fakeFetch(ok, seen) });
    delete process.env.XAI_BASE_URL;
    delete process.env.XAI_MODEL;
    expect(seen[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(seen[0].body?.model).toBe("deepseek-v4-pro");
    process.env.LLM_BASE_URL = "https://llm.example/v1";
    process.env.LLM_MODEL = "other-model";
    await chat({ ...args, fetchImpl: fakeFetch(ok, seen) });
    expect(seen[1].url).toBe("https://llm.example/v1/chat/completions");
    expect(seen[1].body?.model).toBe("other-model");
  });

  it("defaults the temperature to 0.8", () => {
    expect(buildBody(args, "m").temperature).toBe(0.8);
  });
});

describe("success and models", () => {
  it("returns content and usage, and posts to {base}/chat/completions", async () => {
    process.env.LLM_BASE_URL = "https://api.deepseek.com/";
    const seen: { url?: string; body?: Record<string, unknown> }[] = [];
    const res = await chat({
      ...args,
      fetchImpl: fakeFetch({ status: 200, body: { model: "m", choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 7, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 2 } } } }, seen),
    });
    expect(seen[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(res).toMatchObject({ content: "{}", usage: { input: 7, output: 3, cached: 2 } });
  });

  it("reads DeepSeek's prompt_cache_hit_tokens as the cached count", async () => {
    const res = await chat({
      ...args,
      fetchImpl: fakeFetch({ status: 200, body: { choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 64, prompt_cache_miss_tokens: 36 } } }),
    });
    expect(res.usage).toEqual({ input: 100, output: 5, cached: 64 });
    const none = await chat({ ...args, fetchImpl: fakeFetch({ status: 200, body: { choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } }) });
    expect(none.usage.cached).toBe(0);
  });

  it("fails clearly without a key", async () => {
    delete process.env.LLM_API_KEY;
    await expect(chat({ ...args })).rejects.toThrow("LLM_API_KEY is not set");
    await expect(listModels()).rejects.toThrow("LLM_API_KEY is not set");
  });
});
