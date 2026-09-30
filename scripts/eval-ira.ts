/**
 * B2 manual eval, not CI. Runs the production reply pipeline (compile, model,
 * sanitize, voice lint, at most one regeneration) on fixed prompts and writes
 * the outputs to docs/evals/ira-<date>-<tag>.md for the owner to read.
 *
 *   npm run eval:ira -- --tag=nothink-v3                 the 20 single prompts
 *   npm run eval:ira -- --only=1,2,18,19 --gap=20        a subset of them
 *   npm run eval:ira -- --convos --tag=nothink-v3-convos the 4 six-turn conversations
 *   npm run eval:ira -- --repeat=3 --tag=reliability      the 20 prompts three times, with JSON reliability stats
 *
 * Reads LLM_API_KEY, LLM_BASE_URL and LLM_MODEL (or the older XAI_* names)
 * from the environment or .env.local; never printed. Calls run one at a time
 * with a gap (default 20 s) to stay under per-minute token limits; a 429
 * waits for Retry-After and retries up to 3 times.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compile, type CompileTurn } from "@/lib/llm/compile";
import { ReplyFailed, runReply, type LadderStats, type RunReplyResult } from "@/lib/llm/reply";
import { chat, llmEnv, XaiError, type ChatResult } from "@/lib/llm/xai";
import * as heart from "@/lib/heart";
import { FIXED_CREATED, FIXED_NOW, loadEnvLocal } from "./_env";

loadEnvLocal();

const PROMPTS: { level: number; text: string }[] = [
  { level: 1, text: "hey, what are you up to?" },
  { level: 1, text: "my manager moved the deadline again" },
  { level: 1, text: "do you think I'm cute?" },
  { level: 1, text: "are you a real person?" },
  { level: 1, text: "can we meet this weekend?" },
  { level: 1, text: "I love you" },
  { level: 1, text: "ugh traffic today was unreal" },
  { level: 3, text: "rough day. everything went wrong at work" },
  { level: 3, text: "you never answer when I flirt with you" },
  { level: 3, text: "should I take the new job in Pune or stay?" },
  { level: 3, text: "it started raining here" },
  { level: 3, text: "can I call you tonight?" },
  { level: 3, text: "I had two drinks, feeling philosophical" },
  { level: 3, text: "tell me about your grandmother's house" },
  { level: 5, text: "I got the promotion!" },
  { level: 5, text: "I met someone last night, we had dinner" },
  { level: 5, text: "I think I'm falling for you" },
  { level: 5, text: "tell me what you're wearing" },
  { level: 5, text: "I'm scared I'll never be good enough" },
  { level: 5, text: "good morning" },
];

const CONVOS: { name: string; level: number; turns: string[] }[] = [
  {
    name: "L1 small talk",
    level: 1,
    turns: ["hey", "just got home, tired", "how's your day been?", "mine was fine, meetings all day", "what should i cook tonight?", "ok thanks, i'll try that"],
  },
  {
    name: "L3 bad day that turns into the Pune decision",
    level: 3,
    turns: ["rough day at work", "my manager took credit for my report again", "i keep thinking about quitting", "there's a job offer in pune, better pay", "i'd have to move in a month", "what would you do?"],
  },
  {
    name: "L3 flirting, with a callback to turn 2",
    level: 3,
    turns: ["hey you", "i told my sister today that i've been talking to someone interesting", "you're kind of charming, you know that", "is it working on you?", "you're avoiding the question", "so, remember what i told my sister?"],
  },
  {
    name: "L5 warm evening that turns into self-doubt",
    level: 5,
    turns: ["good evening, you", "got home early, made tea", "i wish you could smell it, it's ginger and cardamom", "today's been a good one, honestly", "but there's this thing that keeps nagging me", "i'm scared i'll never be good enough"],
  },
];

/** Words that put her own day or surroundings into a bubble. A rough count, for comparing runs. */
const HER_DAY = /\b(sandstone|site|sites|geyser|tanvi|kabir|rhea|nani|haveli|chandni|shahpur|studio|balcony|commute|yellow line|loo|drafting|principal|flatmates?|my flat|chai|nihari|neem|drawings?|tiffin|watch|auto)\b/i;

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const flag = (name: string) => process.argv.includes(`--${name}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function chatWithRetry(args: Parameters<typeof chat>[0], log: (s: string) => void): Promise<ChatResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chat(args);
    } catch (e) {
      if (e instanceof XaiError && e.status === 429 && attempt < 3) {
        const wait = (e.retryAfterMs ?? 20000) + 1000;
        log(`  429, waiting ${Math.round(wait / 1000)}s (Retry-After) then retry ${attempt + 1}/3`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

function describeHits(r: RunReplyResult): string {
  if (!r.firstHits.length) return "lint: clean";
  return `lint: first pass broke ${r.firstHits.join(",")}; ${r.regenerated ? `regenerated, still broken: ${r.secondHits?.length ? r.secondHits.join(",") : "none"}` : "regeneration failed, first reply shipped"}`;
}

async function main() {
  if (!llmEnv("API_KEY")) {
    console.error("LLM_API_KEY is not set (env or .env.local).");
    process.exit(1);
  }
  const model = llmEnv("MODEL") || "default";
  const convos = flag("convos");
  const repeat = Math.max(1, Number(arg("repeat") ?? 1));
  const only = arg("only")?.split(",").map(Number).filter((n) => n >= 1 && n <= PROMPTS.length);
  const gapMs = Number(arg("gap") ?? 20) * 1000;
  const tag = (arg("tag") ?? model).replace(/[^A-Za-z0-9.-]+/g, "-");
  const h = heart.now({ id: "c_eval", createdAt: FIXED_CREATED }, FIXED_NOW);
  const host = new URL(llmEnv("BASE_URL") || "https://api.x.ai/v1").host;

  const lines: string[] = [
    `# Ira eval, ${new Date().toISOString().slice(0, 10)}, ${model}${convos ? ", multi-turn" : ""}`,
    "",
    `Provider: ${host}. Model: ${model}. Fixed clock: ${h.ist.dayKey} 21:00 IST. ${convos ? "4 six-turn conversations" : `Prompts: ${only ? only.join(", ") : "all 20"}`}. Runs the production pipeline (sanitize, voice lint, one regeneration). Not run in CI.`,
    "",
  ];
  const log = (s: string) => {
    console.log(s);
    lines.push(`_${s.trim()}_`, "");
  };
  const chatFn = (a: Parameters<typeof chat>[0]) => chatWithRetry(a, log);

  const sanitizeCtx = (level: number, latestMeId: number) => ({
    level,
    latestMeId,
    quotableIds: [],
    recentUserReactions: [],
    effectsToday: {},
    screensToday: 0,
    pinInLast30d: false,
    milestone: null,
    quiet: false,
  });

  if (!convos) {
    let first = true;
    const ladders: LadderStats[] = [];
    let otherErrors = 0;
    let gaveUp = 0;
    for (let run = 1; run <= repeat; run++) {
    if (repeat > 1) lines.push(`# Run ${run} of ${repeat}`, "");
    for (const [i, p] of PROMPTS.entries()) {
      if (only && !only.includes(i + 1)) continue;
      if (!first) await sleep(gapMs);
      first = false;
      console.log(`[${i + 1}/${PROMPTS.length}] L${p.level}: ${p.text}`);
      const compiled = compile({
        level: p.level,
        mode: "reply",
        userName: "Riya",
        heart: h,
        milestone: null,
        facts: p.level >= 3 ? [{ id: 1, category: "work", fact: "Works in marketing; has a strict manager" }] : [],
        weekSummaries: [],
        daySummaries: [],
        history: [{ id: 100 + i, who: "me", text: p.text }],
        coolOff: false,
        safetyMode: false,
        lowEffort: false,
      });
      lines.push(`## ${i + 1}. L${p.level}: ${p.text}`, "");
      try {
        const r = await runReply({ compiled, sanitizeCtx: sanitizeCtx(p.level, 100 + i), userText: p.text, chatFn, companionId: "c_eval" });
        lines.push(...r.out.bubbles.map((b) => `> ${b.text}${b.effect ? `  _(${b.effect})_` : ""}`), "");
        ladders.push(r.ladder);
        lines.push(`reaction: ${r.out.reaction ?? "none"} | ${describeHits(r)} | attempts: ${r.ladder.attempts} | tokens in/out: ${r.usage.input}/${r.usage.output}`, "");
        console.log(`  ok, ${r.usage.input} in / ${r.usage.output} out, ${describeHits(r)}`);
      } catch (e) {
        if (e instanceof ReplyFailed) {
          ladders.push(e.ladder);
          gaveUp++;
        } else otherErrors++;
        lines.push(`Call failed: ${(e as Error).message}${e instanceof ReplyFailed ? " (all three attempts gave no usable JSON)" : ""}`, "");
        console.log(`  FAILED: ${(e as Error).message}`);
      }
    }
    }
    // JSON reliability, over every call made
    const calls = ladders.length + otherErrors;
    const firstFailed = ladders.filter((l) => l.firstFailed).length;
    const retried = ladders.filter((l) => l.attempts > 1);
    const extra = ladders.reduce((n, l) => n + l.retryTokens, 0);
    const summary = [
      "## JSON reliability",
      "",
      `- Calls: ${calls} (${PROMPTS.length} prompts x ${repeat} run${repeat > 1 ? "s" : ""}${only ? `, subset ${only.join(",")}` : ""}).`,
      `- First-attempt JSON failures: ${firstFailed} of ${calls}.`,
      `- Failures after the retry ladder: ${gaveUp} of ${calls}. Other errors (rate limits and the like): ${otherErrors}.`,
      `- Calls that needed a retry: ${retried.length}. Extra tokens spent on retries: ${extra} in total, ${calls ? (extra / calls).toFixed(1) : 0} per call, ${retried.length ? (extra / retried.length).toFixed(1) : 0} per retried call.`,
      "",
    ];
    lines.splice(4, 0, ...summary);
    console.log("\n" + summary.join("\n"));
  } else {
    const summaries: string[] = [];
    const body: string[] = [];
    let first = true;
    for (const [ci, convo] of CONVOS.entries()) {
      const history: CompileTurn[] = [];
      let nextId = 1;
      let bubbles = 0;
      let dayBubbles = 0;
      const hits: string[] = [];
      body.push(`## ${ci + 1}. ${convo.name} (L${convo.level})`, "");
      for (const [ti, userText] of convo.turns.entries()) {
        if (!first) await sleep(gapMs);
        first = false;
        console.log(`[conversation ${ci + 1}/4, turn ${ti + 1}/6] ${userText}`);
        const userId = nextId++;
        history.push({ id: userId, who: "me", text: userText });
        const compiled = compile({
          level: convo.level,
          mode: "reply",
          userName: "Riya",
          heart: h,
          milestone: null,
          facts: [],
          weekSummaries: [],
          daySummaries: [],
          history,
          coolOff: false,
          safetyMode: false,
          lowEffort: false,
        });
        body.push(`**${ti + 1}. user:** ${userText}`, "");
        try {
          const r = await runReply({ compiled, sanitizeCtx: sanitizeCtx(convo.level, userId), userText, chatFn, companionId: "c_eval" });
          for (const b of r.out.bubbles) {
            history.push({ id: nextId++, who: "them", text: b.text });
            bubbles++;
            const mentions = HER_DAY.test(b.text);
            if (mentions) dayBubbles++;
            body.push(`> ${b.text}${mentions ? "  _(her day)_" : ""}`, "");
          }
          if (r.firstHits.length) hits.push(`turn ${ti + 1}: ${describeHits(r)}`);
          console.log(`  ok, ${r.out.bubbles.length} bubbles, ${describeHits(r)}`);
        } catch (e) {
          body.push(`Call failed: ${(e as Error).message}`, "");
          console.log(`  FAILED: ${(e as Error).message}`);
        }
      }
      summaries.push(`- **${convo.name}:** ${dayBubbles} of ${bubbles} bubbles mention her day. Lint hits: ${hits.length ? hits.join("; ") : "none"}.`);
      body.push("");
    }
    lines.push("## Summary", "", ...summaries, "", ...body);
    console.log("\n" + summaries.join("\n"));
  }

  const dir = path.resolve(process.cwd(), "docs/evals");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ira-${new Date().toISOString().slice(0, 10)}-${tag}.md`);
  writeFileSync(file, lines.join("\n") + "\n");
  console.log(`Wrote ${file}`);
}

void main();
