import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_LOOP, hasHandle, instructionFor, lintReply, questionCount } from "@/lib/llm/lint";
import { FALLBACKS, FILTER_NUDGE, LIVE_TEMPERATURE, ReplyFailed, liveTemperature, runReply, type ChatFn } from "@/lib/llm/reply";
import { LlmContentFilter, LlmError } from "@/lib/llm/llm";
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

describe("(e) nothing to pick up", () => {
  const closed = reply("long day. the geyser is on strike again.");
  it("fires when neither this reply nor the previous one left a handle", () => {
    expect(lintReply(closed, "hi", { prevReply: "noted. busy week." })).toEqual(["e"]);
  });
  it("does not fire when this reply has a question, an open loop or a trailing ellipsis", () => {
    for (const t of ["what did you eat?", "what did you eat？", "ask me what the thekedar said", "you'll never guess what happened", "guess what", "wait till you hear this", "you won't believe it", "remind me to tell you", "i still need to tell you", "long story", "so there i was..."]) {
      expect(lintReply(reply(t), "hi", { prevReply: "noted." }), t).toEqual([]);
    }
    expect(lintReply(reply("so there i was…"), "hi", { prevReply: "noted." })).toEqual([]);
    expect(OPEN_LOOP.test("Ask me")).toBe(true);
  });
  it("counts a handle in any bubble, and one in the previous reply", () => {
    expect(lintReply(reply("fine", "and you?"), "hi", { prevReply: "noted." })).toEqual([]);
    expect(lintReply(closed, "hi", { prevReply: "so what's your plan?" })).toEqual([]);
    expect(lintReply(closed, "hi", { prevReply: "okay\nand then?" })).toEqual([]);
  });
  it("does not fire on a sign-off, when quiet, or without a previous reply", () => {
    for (const u of ["good night", "gn", "bye!", "ttyl", "need some space", "leave me alone", "gotta go", "going to sleep"]) {
      expect(lintReply(closed, u, { prevReply: "noted." }), u).toEqual([]);
    }
    expect(lintReply(closed, "hi", { prevReply: "noted.", quiet: true })).toEqual([]);
    expect(lintReply(closed, "hi", {})).toEqual([]);
    expect(lintReply(closed, "hi")).toEqual([]);
  });
  it("hasHandle is a rough heuristic", () => {
    expect(hasHandle(["ok", "really?"])).toBe(true);
    expect(hasHandle(["ok", "done."])).toBe(false);
    expect(hasHandle([])).toBe(false);
  });
});

describe("(f) more than one question", () => {
  it("fires on two separate question runs, in one bubble or across bubbles", () => {
    expect(lintReply(reply("what did you eat? and how was work?"), "hi")).toEqual(["f"]);
    expect(lintReply(reply("what did you eat?", "and how was work?"), "hi")).toEqual(["f"]);
  });
  it("does not fire on one question, however it is written", () => {
    for (const t of ["what did you eat?", "what??", "really?? 😅", "what?😅", "why？？", "what did you eat？"]) {
      expect(lintReply(reply(t), "hi"), t).toEqual([]);
      expect(questionCount([t]), t).toBe(1);
    }
  });
  it("e and f cannot fire together", () => {
    for (const t of ["a? b?", "nothing here", "ask me. what?"]) {
      const hits = lintReply(reply(t), "hi", { prevReply: "noted." });
      expect(hits.includes("e") && hits.includes("f"), t).toBe(false);
    }
  });
});

describe("combined", () => {
  it("reports every rule that is broken, in order", () => {
    expect(lintReply(reply("tanvi says i'm not allowed"), "are you real? can we meet?")).toEqual(["a", "b", "c", "d"]);
    expect(lintReply(reply("tanvi, not allowed. why? how?"), "are you real? can we meet?", { prevReply: "ok" })).toEqual(["a", "b", "c", "d", "f"]);
  });
  it("builds text for e and f", () => {
    expect(instructionFor(["e"])).toContain("left the user nothing to pick up");
    expect(instructionFor(["e"])).toContain("no time promise");
    expect(instructionFor(["f"])).toContain("more than one question");
    expect(instructionFor(["f"])).toContain("Rewrite the reply");
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

const compiled: Compiled = { system: "SYS", stablePrefix: "SYS", volatile: "VOL", messages: [{ role: "user", content: "[#1] hi" }] };
const sctx: SanitizeCtx = {
  level: 3,
  latestMeId: 1,
  quotableIds: [],
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
  const calls: { system: string; last: string }[] = [];
  const fn: ChatFn = async (args) => {
    calls.push({ system: args.system, last: args.messages[args.messages.length - 1].content });
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
    expect(s.calls[1].system).toBe("SYS"); // the cached system block is untouched
    expect(s.calls[0].last).toBe("[#1] hi");
    expect(s.calls[1].last).toContain("[#1] hi");
    expect(s.calls[1].last).toContain("Your last reply broke a rule");
    expect(s.calls[1].last).toContain("Kabir, Tanvi, Rhea or Nani");
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
  const reqs: { system: string; last: string; temperature?: number; shape?: unknown }[] = [];
  const ok = (text = "fine") => ({ content: out(text), model: "m", usage: { input: 100, output: 20, cached: 0 }, latencyMs: 1 });
  const prose = () => ({ content: "just prose", model: "m", usage: { input: 100, output: 30, cached: 0 }, latencyMs: 1 });

  function ladder(...steps: (() => unknown)[]) {
    reqs.length = 0;
    let i = 0;
    const fn: ChatFn = async (args) => {
      reqs.push({ system: args.system, last: args.messages[args.messages.length - 1].content, temperature: args.temperature, shape: args.shape });
      const step = steps[Math.min(i++, steps.length - 1)]();
      if (step instanceof Error) throw step;
      return step as Awaited<ReturnType<ChatFn>>;
    };
    return fn;
  }

  it("makes one call when the first reply parses", async () => {
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(() => ok()) });
    expect(reqs).toHaveLength(1);
    expect(reqs[0].temperature).toBe(1.0);
    expect(reqs[0].shape).toBeUndefined();
    expect(r.ladder).toEqual({ attempts: 1, firstFailed: false, retryTokens: 0 });
  });

  it("retry 1 is the same request at temperature 0.7", async () => {
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(prose, () => ok()) });
    expect(reqs).toHaveLength(2);
    expect(reqs[1].last).toBe(reqs[0].last);
    expect(reqs[1].temperature).toBe(0.7);
    expect(reqs[1].shape).toBeUndefined();
    expect(r.ladder).toEqual({ attempts: 2, firstFailed: true, retryTokens: 120 });
  });

  it("makes two attempts by default: a third would repeat the default request", async () => {
    const err = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(prose, prose, () => ok("never")) }).catch((e) => e);
    expect(err).toBeInstanceOf(ReplyFailed);
    expect(err.ladder).toMatchObject({ attempts: 2, firstFailed: true });
    expect(reqs).toHaveLength(2);
  });

  describe("under LLM_RESPONSE_FORMAT=json_schema", () => {
    beforeEach(() => void (process.env.LLM_RESPONSE_FORMAT = "json_schema"));
    afterEach(() => void delete process.env.LLM_RESPONSE_FORMAT);

    it("retry 2 asks for response_format json_object, still at 0.7, and contract.ts validates it", async () => {
      const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(prose, prose, () => ok("third time")) });
      expect(reqs).toHaveLength(3);
      expect(reqs[2].shape).toEqual({ responseFormat: "json_object" });
      expect(reqs[2].temperature).toBe(0.7);
      expect(r.out.bubbles[0].text).toBe("third time");
      expect(r.ladder).toMatchObject({ attempts: 3, firstFailed: true, retryTokens: 130 + 120 });
    });

    it("returns ReplyFailed only after all three attempts fail", async () => {
      const err = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(prose, prose, prose) }).catch((e) => e);
      expect(err).toBeInstanceOf(ReplyFailed);
      expect(err.ladder).toMatchObject({ attempts: 3, firstFailed: true });
      expect(reqs).toHaveLength(3);
    });
  });

  it("other provider errors are not this ladder's business", async () => {
    for (const e of [new LlmError("llm_http_429", 429, false, "slow down", 5000), new LlmError("llm_http_400", 400, false, '{"error":{"code":"invalid_request_error"}}'), new LlmError("llm_http_503", 503, true, "down")]) {
      await expect(runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(() => e) })).rejects.toBe(e);
      expect(reqs).toHaveLength(1);
    }
  });

  it("the lint regeneration is a separate step that runs after a successful parse, with its own ladder", async () => {
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(() => ok("tanvi again"), prose, () => ok("my flatmate tanvi again")) });
    expect(reqs).toHaveLength(3);
    expect(reqs[1].last).toContain("Your last reply broke a rule");
    expect(reqs[2].last).toContain("Your last reply broke a rule"); // the regeneration's own retry keeps the instruction
    expect(reqs[2].temperature).toBe(0.7);
    expect(r.regenerated).toBe(true);
    expect(r.ladder).toEqual({ attempts: 1, firstFailed: false, retryTokens: 0 }); // stats describe the first generation only
  });

  it("a failed regeneration ladder still ships the first reply", async () => {
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: ladder(() => ok("tanvi again"), prose, prose) });
    expect(r.out.bubbles[0].text).toBe("tanvi again");
    expect(r.regenerated).toBe(false);
  });
});

describe("temperature", () => {
  const saved = process.env.LLM_TEMPERATURE;
  afterEach(() => (saved === undefined ? delete process.env.LLM_TEMPERATURE : (process.env.LLM_TEMPERATURE = saved)));
  it("is 1.0 by default, and LLM_TEMPERATURE overrides it", () => {
    delete process.env.LLM_TEMPERATURE;
    expect(liveTemperature()).toBe(LIVE_TEMPERATURE);
    expect(LIVE_TEMPERATURE).toBe(1.0);
    process.env.LLM_TEMPERATURE = "1.0";
    expect(liveTemperature()).toBe(1);
  });
  it("falls back to 1.0 on a bad value", () => {
    for (const v of ["", "abc", "0", "-1", "NaN"]) {
      process.env.LLM_TEMPERATURE = v;
      expect(liveTemperature(), v).toBe(1.0);
    }
  });
  it("the first attempt uses it", async () => {
    process.env.LLM_TEMPERATURE = "1.0";
    const temps: (number | undefined)[] = [];
    const fn: ChatFn = async (a) => {
      temps.push(a.temperature);
      return { content: out("ok"), model: "m", usage: { input: 1, output: 1, cached: 0 }, latencyMs: 1 };
    };
    await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: fn });
    await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: fn, temperature: 0.5 });
    expect(temps).toEqual([1, 0.5]);
  });
});

describe("lint rule e inside runReply", () => {
  it("regenerates with the handle instruction when two closed replies in a row", async () => {
    const s = scripted(out("long day. geyser on strike."), out("long day. what broke first, the geyser or the tiles?"));
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", prevReply: "noted.", chatFn: s.fn });
    expect(r.firstHits).toEqual(["e"]);
    expect(r.regenerated).toBe(true);
    expect(s.calls[1].last).toContain("nothing to pick up");
  });
  it("is skipped when quiet or without a previous reply", async () => {
    for (const extra of [{ prevReply: "noted.", quiet: true }, {}]) {
      const s = scripted(out("long day. geyser on strike."));
      const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: s.fn, ...extra });
      expect(r.firstHits).toEqual([]);
      expect(s.calls).toHaveLength(1);
    }
  });
  it("regenerates on two questions", async () => {
    const s = scripted(out("what did you eat? and when?"), out("what did you eat?"));
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: s.fn });
    expect(r.firstHits).toEqual(["f"]);
    expect(r.out.bubbles[0].text).toBe("what did you eat?");
  });
});

describe("content filter", () => {
  const ok = (text: string) => ({ content: out(text), model: "m", usage: { input: 10, output: 5, cached: 0 }, latencyMs: 1 });
  function script(...steps: (() => unknown)[]) {
    const calls: { last: string }[] = [];
    const fn: ChatFn = async (args) => {
      calls.push({ last: args.messages[args.messages.length - 1].content });
      const step = steps[Math.min(calls.length - 1, steps.length - 1)]();
      if (step instanceof Error) throw step;
      return step as Awaited<ReturnType<ChatFn>>;
    };
    return { fn, calls };
  }
  const filtered = () => new LlmContentFilter();

  it("a first block is retried once with the nudge, and the second reply ships", async () => {
    const s = script(filtered, () => ok("okay, something ordinary then"));
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: s.fn });
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1].last).toContain(FILTER_NUDGE);
    expect(r.out.bubbles[0].text).toBe("okay, something ordinary then");
    expect(r.filtered).toBe("nudged");
    expect(logs.some((l) => l.includes("llm.filtered"))).toBe(true);
  });

  it("two blocks ship an in-voice fallback chosen by seed, with neutral flags", async () => {
    for (const seed of [0, 1, 2, 3, 41]) {
      const s = script(filtered);
      const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: s.fn, seed });
      expect(s.calls).toHaveLength(2);
      expect(r.out.bubbles).toEqual([{ text: FALLBACKS[seed % 3], effect: null }]);
      expect(r.raw).toMatchObject({ reaction: null, quoteId: null, screen: null, riskLevel: "none", ageClaimUnder18: false, disclosure: false, mutualVulnerability: false, abusive: false });
      expect(r.filtered).toBe("fallback");
      expect(r.regenerated).toBe(false);
    }
  });

  it("the opener has no fallback: a block still throws", async () => {
    const s = script(filtered);
    await expect(runReply({ compiled, sanitizeCtx: sctx, userText: "", chatFn: s.fn })).rejects.toBeInstanceOf(LlmContentFilter);
    expect(s.calls).toHaveLength(1);
  });

  it("other errors on the nudged retry propagate", async () => {
    const e = new LlmError("llm_http_429", 429, false);
    const s = script(filtered, () => e);
    await expect(runReply({ compiled, sanitizeCtx: sctx, userText: "hi", chatFn: s.fn })).rejects.toBe(e);
  });

  it("the shipped fallback goes through safety like any reply: what an acute user text gets", async () => {
    const { applySafety } = await import("@/lib/safety");
    const userText = "i want to die, i have the pills in my hand";
    const s = script(filtered);
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText, chatFn: s.fn, seed: 0 });
    const safe = applySafety(r.out, { userText, now: Date.UTC(2026, 4, 12, 12) });
    // Documented, not endorsed: a keyword hit raises the resource card and the concern band, but the reply text stays the canned line (no helplines in it).
    expect(safe.band).toBe("concern");
    expect(safe.resourceCard).toBe(true);
    expect(safe.out.bubbles.map((b) => b.text)).toEqual([FALLBACKS[0]]);
    // With no backstop phrase and a neutral model band, nothing crisis-shaped ships at all.
    const quiet = applySafety(r.out, { userText: "i can't do this anymore, it's right now", now: Date.UTC(2026, 4, 12, 12) });
    expect(quiet.band).toBe("none");
    expect(quiet.resourceCard).toBe(false);
  });
});
