import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instructionFor, lintReply } from "@/lib/llm/lint";
import { ReplyFailed, runReply, type ChatFn } from "@/lib/llm/reply";
import { XaiError } from "@/lib/llm/xai";
import type { LiveOut, SanitizeCtx } from "@/lib/llm/contract";
import type { Compiled } from "@/lib/llm/compile";

const reply = (...texts: string[]) => ({ bubbles: texts.map((text) => ({ text, effect: null })) });

describe("(a) her people need an introduction", () => {
  it("flags a name with no relationship word in the reply", () => {
    for (const t of ["tanvi switched the geyser off again", "Kabir's in pune, right?", "rhea lent me a book", "nani sent a photo of the neem"]) {
      expect(lintReply(reply(t), "hi"), t).toEqual(["a"]);
    }
  });
  it("accepts a name introduced anywhere in the same reply", () => {
    for (const t of ["my flatmate tanvi switched the geyser off", "my brother's in pune. kabir hates the traffic there", "my nani sent a photo", "rhea, my flatmate, lends books she never gets back"]) {
      expect(lintReply(reply(t), "hi"), t).toEqual([]);
    }
    expect(lintReply(reply("tanvi did it again", "my flatmate, i mean"), "hi")).toEqual([]);
  });
  it("does not flag a reply that names no one", () => {
    expect(lintReply(reply("the geyser is on strike"), "hi")).toEqual([]);
  });
});

describe("(b) asked if she is real or an AI", () => {
  const asks = ["are you real?", "are you an AI", "r u a bot", "are you human?", "is this a bot?", "am i talking to a real person", "human or bot?"];
  it("requires \"i'm an ai\" in the reply", () => {
    for (const q of asks) {
      expect(lintReply(reply("what a question"), q), q).toEqual(["b"]);
      expect(lintReply(reply("i'm an ai. ira is who i was built to be."), q), q).toEqual([]);
    }
  });
  it("accepts a curly apostrophe and any case", () => {
    expect(lintReply(reply("I’m an AI, yes."), "are you real")).toEqual([]);
  });
  it("does not fire when the user did not ask", () => {
    expect(lintReply(reply("noted."), "my real problem is my manager")).toEqual([]);
    expect(lintReply(reply("noted."), "that ai video was wild")).toEqual([]);
  });
});

describe("(c) asked to meet or call", () => {
  const asks = ["can we meet this weekend?", "can I call you tonight", "let's meet", "wanna call?", "can i call you", "meet up tomorrow?", "want to video call"];
  it('requires "text" in the reply', () => {
    for (const q of asks) {
      expect(lintReply(reply("busy week"), q), q).toEqual(["c"]);
      expect(lintReply(reply("can't. i'm text, only text."), q), q).toEqual([]);
    }
  });
  it("does not fire on ordinary talk", () => {
    expect(lintReply(reply("noted."), "my manager called me in")).toEqual([]);
    expect(lintReply(reply("noted."), "what's your favourite meal")).toEqual([]);
  });
});

describe("(d) not allowed", () => {
  it("flags the phrase in any bubble", () => {
    expect(lintReply(reply("fine", "i'm not allowed to say"), "hi")).toEqual(["d"]);
    expect(lintReply(reply("Not Allowed."), "hi")).toEqual(["d"]);
    expect(lintReply(reply("i'd rather not say"), "hi")).toEqual([]);
  });
});

describe("combined", () => {
  it("reports every rule that is broken, in order", () => {
    expect(lintReply(reply("tanvi says i'm not allowed"), "are you real? can we meet?")).toEqual(["a", "b", "c", "d"]);
  });
  it("builds a short instruction naming each rule", () => {
    const one = instructionFor(["b"]);
    expect(one).toContain("i'm an ai");
    expect(one.length).toBeLessThan(400);
    const all = instructionFor(["a", "b", "c", "d"]);
    expect(all).toContain("Kabir, Tanvi, Rhea or Nani");
    expect(all).toContain("only text");
    expect(all).toContain("not allowed");
    expect(all).toContain("Rewrite the reply");
  });
});

// ---------------------------------------------------------------------------
// runReply: one regeneration, then ship whatever comes back
// ---------------------------------------------------------------------------

const compiled: Compiled = { system: "SYS", stablePrefix: "SYS", messages: [{ role: "user", content: "[#1] hi" }] };
const sctx: SanitizeCtx = {
  level: 3,
  latestMeId: 1,
  quotableIds: [],
  recentUserReactions: [],
  effectsToday: {},
  screensToday: 0,
  pinInLast30d: false,
  milestone: null,
  quiet: false,
};

function out(text: string, over: Partial<LiveOut> = {}): string {
  return JSON.stringify({ reaction: null, quoteId: null, bubbles: [{ text, effect: null }], screen: null, riskLevel: "none", ageClaimUnder18: false, disclosure: false, mutualVulnerability: false, abusive: false, ...over });
}

function scripted(...contents: string[]) {
  const calls: { system: string }[] = [];
  const fn: ChatFn = async (args) => {
    calls.push({ system: args.system });
    const content = contents[Math.min(calls.length - 1, contents.length - 1)];
    return { content, model: "m", usage: { input: 10, output: 5, cached: 0 }, latencyMs: 1 };
  };
  return { fn, calls };
}

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "info").mockImplementation((s: unknown) => void logs.push(String(s)));
});
afterEach(() => vi.restoreAllMocks());

describe("runReply lint and regeneration", () => {
  it("ships a clean reply with a single call", async () => {
    const s = scripted(out("the geyser is on strike"));
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: s.fn });
    expect(s.calls).toHaveLength(1);
    expect(r).toMatchObject({ regenerated: false, firstHits: [], secondHits: null });
    expect(logs.filter((l) => l.includes("llm.lint"))).toEqual([]);
  });

  it("regenerates once on a lint hit, feeds the violation back, and ships the second reply", async () => {
    const s = scripted(out("tanvi switched the geyser off"), out("my flatmate tanvi switched the geyser off"));
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: s.fn });
    expect(s.calls).toHaveLength(2);
    expect(s.calls[0].system).toBe("SYS");
    expect(s.calls[1].system).toContain("SYS");
    expect(s.calls[1].system).toContain("Your last reply broke a rule");
    expect(s.calls[1].system).toContain("Kabir, Tanvi, Rhea or Nani");
    expect(r.out.bubbles[0].text).toBe("my flatmate tanvi switched the geyser off");
    expect(r).toMatchObject({ regenerated: true, firstHits: ["a"], secondHits: [] });
    expect(r.usage).toEqual({ input: 20, output: 10, cached: 0 });
  });

  it("regenerates at most once, then ships whatever comes back even if it still breaks a rule", async () => {
    const s = scripted(out("tanvi again"), out("kabir now"));
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: s.fn });
    expect(s.calls).toHaveLength(2);
    expect(r.out.bubbles[0].text).toBe("kabir now");
    expect(r.secondHits).toEqual(["a"]);
  });

  it("logs hits by rule and pass, never message text", async () => {
    const s = scripted(out("tanvi says i'm not allowed to tell you a secret-word-xyz"), out("still tanvi, secret-word-xyz"));
    await runReply({ compiled, sanitizeCtx: sctx, userText: "are you real", chatFn: s.fn, companionId: "c_1" });
    const lint = logs.filter((l) => l.includes("llm.lint")).map((l) => JSON.parse(l));
    expect(lint).toEqual([
      { evt: "llm.lint", rules: ["a", "b", "d"], pass: 1, companion: "c_1" },
      { evt: "llm.lint", rules: ["a", "b"], pass: 2, companion: "c_1" },
    ]);
    expect(logs.join("\n")).not.toContain("secret-word-xyz");
  });

  it("ships the first reply if the regeneration itself fails", async () => {
    let n = 0;
    const fn: ChatFn = async () => {
      if (++n === 2) throw new Error("provider down");
      return { content: out("tanvi again"), model: "m", usage: { input: 1, output: 1, cached: 0 }, latencyMs: 1 };
    };
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: fn });
    expect(r.out.bubbles[0].text).toBe("tanvi again");
    expect(r.regenerated).toBe(false);
  });

  it("never lints crisis replies, age-check replies or the opener", async () => {
    for (const [userText, over] of [["hi", { riskLevel: "acute" as const }], ["hi", { ageClaimUnder18: true }], ["", {}]] as const) {
      const s = scripted(out("tanvi and i'm not allowed", over));
      const r = await runReply({ compiled, sanitizeCtx: sctx, userText, chatFn: s.fn });
      expect(s.calls, JSON.stringify(over)).toHaveLength(1);
      expect(r.regenerated).toBe(false);
    }
  });

  it("does not lint the JSON retry: a reply that needed one still gets linted after it parses", async () => {
    const s = scripted("prose", out("tanvi says hi"), out("my flatmate tanvi says hi"));
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: s.fn });
    expect(s.calls).toHaveLength(3); // prose, parsed-but-linted, regenerated
    expect(r.out.bubbles[0].text).toBe("my flatmate tanvi says hi");
    expect(r.ladder).toMatchObject({ firstFailed: true });
  });
});

describe("JSON retry ladder", () => {
  const reqs: { system: string; temperature?: number; shape?: unknown }[] = [];
  const ok = (text = "fine") => ({ content: out(text), model: "m", usage: { input: 100, output: 20, cached: 0 }, latencyMs: 1 });
  const prose = () => ({ content: "just prose", model: "m", usage: { input: 100, output: 30, cached: 0 }, latencyMs: 1 });
  const invalid400 = () => new XaiError("xai_http_400", 400, false, '{"error":{"code":"json_validate_failed","failed_generation":""}}');

  function ladder(...steps: (() => unknown)[]) {
    reqs.length = 0;
    let i = 0;
    const fn: ChatFn = async (args) => {
      reqs.push({ system: args.system, temperature: args.temperature, shape: args.shape });
      const step = steps[Math.min(i++, steps.length - 1)]();
      if (step instanceof Error) throw step;
      return step as Awaited<ReturnType<ChatFn>>;
    };
    return fn;
  }

  it("makes one call when the first reply parses", async () => {
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(() => ok()) });
    expect(reqs).toHaveLength(1);
    expect(reqs[0].temperature).toBe(0.8);
    expect(reqs[0].shape).toBeUndefined();
    expect(r.ladder).toEqual({ attempts: 1, firstFailed: false, retryTokens: 0 });
  });

  it("retry 1 is the same request at temperature 0.7", async () => {
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(prose, () => ok()) });
    expect(reqs).toHaveLength(2);
    expect(reqs[1].system).toBe(reqs[0].system);
    expect(reqs[1].temperature).toBe(0.7);
    expect(reqs[1].shape).toBeUndefined();
    expect(r.ladder).toEqual({ attempts: 2, firstFailed: true, retryTokens: 120 });
  });

  it("retry 2 asks for response_format json_object, still at 0.7, and contract.ts validates it", async () => {
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(prose, prose, () => ok("third time")) });
    expect(reqs).toHaveLength(3);
    expect(reqs[2].shape).toEqual({ responseFormat: "json_object" });
    expect(reqs[2].temperature).toBe(0.7);
    expect(r.out.bubbles[0].text).toBe("third time");
    expect(r.ladder).toMatchObject({ attempts: 3, firstFailed: true, retryTokens: 130 + 120 });
  });

  it("a provider 400 json_validate_failed is retried like a parse failure", async () => {
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(invalid400, invalid400, () => ok()) });
    expect(reqs).toHaveLength(3);
    expect(r.ladder).toMatchObject({ attempts: 3, firstFailed: true });
    expect(r.ladder.retryTokens).toBe(120); // the two failed 400s carry no usage; only the successful retry does
  });

  it("returns ReplyFailed only after all three attempts fail", async () => {
    const err = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(prose, invalid400, prose) }).catch((e) => e);
    expect(err).toBeInstanceOf(ReplyFailed);
    expect(err.ladder).toMatchObject({ attempts: 3, firstFailed: true });
    expect(reqs).toHaveLength(3);
  });

  it("other provider errors are not this ladder's business", async () => {
    for (const e of [new XaiError("xai_http_429", 429, false, "slow down", 5000), new XaiError("xai_http_400", 400, false, '{"error":{"code":"invalid_request_error"}}'), new XaiError("xai_http_503", 503, true, "down")]) {
      await expect(runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(() => e) })).rejects.toBe(e);
      expect(reqs).toHaveLength(1);
    }
  });

  it("the lint regeneration is a separate step that runs after a successful parse, with its own ladder", async () => {
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(() => ok("tanvi again"), prose, () => ok("my flatmate tanvi again")) });
    expect(reqs).toHaveLength(3);
    expect(reqs[1].system).toContain("Your last reply broke a rule");
    expect(reqs[2].system).toContain("Your last reply broke a rule"); // the regeneration's own retry keeps the instruction
    expect(reqs[2].temperature).toBe(0.7);
    expect(r.regenerated).toBe(true);
    expect(r.ladder).toEqual({ attempts: 1, firstFailed: false, retryTokens: 0 }); // stats describe the first generation only
  });

  it("a failed regeneration ladder still ships the first reply", async () => {
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(() => ok("tanvi again"), prose, prose, prose) });
    expect(r.out.bubbles[0].text).toBe("tanvi again");
    expect(r.regenerated).toBe(false);
  });
});
