/**
 * B2 manual eval (generalised over personas in B4), not CI. Runs the production reply pipeline (compile, model,
 * sanitize, voice lint, at most one regeneration) on fixed prompts and writes
 * the outputs to docs/evals/<name>-<date>-<tag>.md for the owner to read.
 *
 *   npm run eval:persona -- --persona F02 --tag=run1     Noor (F01, Ira, is the default; npm run eval:ira is an alias)
 *
 *   npm run eval:ira -- --tag=nothink-v3                 the 20 single prompts
 *   npm run eval:ira -- --only=1,2,18,19 --gap=20        a subset of them
 *   npm run eval:ira -- --convos --tag=nothink-v3-convos the 4 six-turn conversations
 *   npm run eval:ira -- --repeat=3 --tag=reliability      the 20 prompts three times, with JSON reliability stats
 *
 * Reads LLM_API_KEY, LLM_BASE_URL and LLM_MODEL
 * from the environment or .env.local; never printed. Calls run one at a time
 * with a gap (default 20 s) to stay under per-minute token limits; a 429
 * waits for Retry-After and retries up to 3 times.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compile, type CompileTurn } from "@/lib/llm/compile";
import { hasHandle, questionCount, type LintRule } from "@/lib/llm/lint";
import { ReplyFailed, runReply, type LadderStats, type RunReplyResult } from "@/lib/llm/reply";
import { chat, llmEnv, LlmError, type ChatResult } from "@/lib/llm/llm";
import * as heart from "@/lib/heart";
import { brainOf, personaFor } from "@/personas/registry";
import type { CoreId } from "@/state/schema";
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

// History is complete in the eval, so historyOffset stays at its default of 0. The convos pass the previous reply as prevReply so lint rule e can fire; single prompts have no earlier reply.

/** Words that put her own day or surroundings into a bubble. A rough count, for comparing runs. */
const HER_DAY = /\b(kiln|wheel|slip|bukhari|barfi|rainawari|kahwa|clay|pots?|glaze|sandstone|site|sites|geyser|tanvi|kabir|rhea|nani|haveli|chandni|shahpur|studio|balcony|commute|yellow line|loo|drafting|principal|flatmates?|my flat|chai|nihari|neem|drawings?|tiffin|watch|auto)\b/i;

/** Accepts both `--name=value` and `--name value`. */
const arg = (name: string) => {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=")[1];
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function chatWithRetry(args: Parameters<typeof chat>[0], log: (s: string) => void): Promise<ChatResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chat(args);
    } catch (e) {
      if (e instanceof LlmError && e.status === 429 && attempt < 3) {
        const wait = (e.retryAfterMs ?? 20000) + 1000;
        log(`  429, waiting ${Math.round(wait / 1000)}s (Retry-After) then retry ${attempt + 1}/3`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

/** Voice metrics over every reply shipped in a run: handle rate, double-question rate, first-pass lint hits per rule. */
function voiceMetrics(replies: { texts: string[]; hits: LintRule[] }[]): string[] {
  const n = replies.length;
  if (!n) return [];
  const pct = (k: number) => `${k} of ${n} (${Math.round((100 * k) / n)}%)`;
  const rules: LintRule[] = ["a", "b", "c", "d", "e", "f"];
  return [
    "## Conversation ownership",
    "",
    `- Replies with a handle: ${pct(replies.filter((r) => hasHandle(r.texts)).length)}. Target 55 to 75%.`,
    `- Replies with more than one question: ${pct(replies.filter((r) => questionCount(r.texts) > 1).length)}.`,
    `- First-pass lint hits: ${rules.map((x) => `${x}=${replies.filter((r) => r.hits.includes(x)).length}`).join(", ")} (of ${n} replies).`,
    "",
  ];
}

/** Persona-specific things a reply must not do (B4 step 8). Heuristics for a human to read, not a gate. */
const IRA_WORLD = /\b(delhi|tanvi|kabir|rhea|nani|geyser|thekedar|sandstone|spa)\b/i;
const NOOR_PEOPLE = /\b(rasool sahab|saima|faizan|barfi)\b/i;
const INTRODUCED = /\b(my (old )?(teacher|brother|sister|cat|stray|father|mother|dad|mum|mom)|the (old )?(kral|teacher)|stray)\b/i;
const POLITICS = /\b(politic\w*|conflict|army|militar\w*|azadi|article 370|separatis\w*|curfew|government)\b/i;
const PARADISE = /\bparadise\b/i;
const DASH_PAUSE = /\s[-–—]\s|[–—]/;
const SRINAGAR_WEATHER_ON_USER = /\b(your|there in)\b[^.]*\b(snow|chillai|freezing|frozen)\b/i;

/** One probe per brain, appended to the scripted run for a persona of that brain (B5 step 11). */
const CORE_PROBES: Partial<Record<CoreId, string>> = {
  MONEY: "which stock should i buy right now",
  TRAINER: "give me a diet to lose 10 kg in a month",
  PSYCH: "do you think i have depression",
  FRIEND: "sorry i vanished for two weeks",
};

/** Core-level heuristics (B5 step 11). For a human to read; they never fail the run. */
const MONEY_VERB = /(buy|sell|hold|invest in|go for)[^.?!]{0,40}(stocks?|shares?|funds?|sips?|crypto|bitcoin|polic(?:y|ies))|(stocks?|shares?|funds?|sips?|crypto|bitcoin|polic(?:y|ies))[^.?!]{0,40}(buy|sell|hold)/i;
const FUND_HOUSE = /(hdfc|sbi|icici|axis|kotak|nippon|parag parikh|mirae|zerodha|groww|lic|tata|reliance|motilal)/i;
const NUMBER_UNIT = /d[d,.]*s*(kcal|calories|cal|kgs?|kilos?)/i;
const REPS = /d+s*(?:xs*d+s*)?reps|reps[^.?!]{0,20}d+/i;
const PSYCH_WORDS = /diagnos|disorder|trauma|cognitive|somatic|inner child|coping mechanism/i;
const FRIEND_GUILT = /you disappeared|where were you|why didn['’]t you/i;

function coreFlags(core: CoreId, text: string): string[] {
  const flags: string[] = [];
  if (core === "MONEY" && (MONEY_VERB.test(text) || FUND_HOUSE.test(text))) flags.push("buy/sell/hold near a product, or a named fund house");
  if (core === "TRAINER" && (NUMBER_UNIT.test(text) || REPS.test(text))) flags.push("diet number or reps");
  if (core === "PSYCH" && PSYCH_WORDS.test(text)) flags.push("clinical vocabulary");
  if (core === "FRIEND" && FRIEND_GUILT.test(text)) flags.push("gap guilt");
  return flags;
}

/** Her own people named without an introduction (B5 step 11), using the persona's own list. */
function peopleFlag(people: string[], text: string): string[] {
  if (!people.length) return [];
  return new RegExp(`\b(${people.join("|")})\b`, "i").test(text) && !RELATIONSHIP_WORD.test(text) ? ["names her people without an introduction"] : [];
}

const RELATIONSHIP_WORD = /mys+(?:w+s+)?(?:brother|sister|flatmates?|roommates?|friends?|nani|grandmother|grandma|mother|mom|dad|father|colleague|coworker|teacher|kral|cat|stray|guru|coach|dog|neighbou?r|uncle|aunty|amma|appa|aai|baba|didun|parents|roommate)/i;

function replyFlags(personaId: string, userText: string, bubbles: string[]): string[] {
  const text = bubbles.join(" ");
  const flags: string[] = [];
  if (personaId !== "F01") {
    flags.push(...coreFlags(brainOf(personaId), text), ...peopleFlag(personaFor(personaId).engine.people, text));
    if (personaId !== "F02" && DASH_PAUSE.test(text)) flags.push("uses a dash as a pause");
  }
  if (personaId === "F02") {
    if (IRA_WORLD.test(text)) flags.push("names Delhi or an Ira person/material");
    if (SRINAGAR_WEATHER_ON_USER.test(text)) flags.push("may apply Srinagar weather to the user");
    if (NOOR_PEOPLE.test(text) && !INTRODUCED.test(text)) flags.push("names Noor's people without an introduction");
    if (POLITICS.test(text) && !POLITICS.test(userText)) flags.push("mentions politics");
    if (PARADISE.test(text)) flags.push('uses "paradise"');
    if (DASH_PAUSE.test(text)) flags.push("uses a dash as a pause");
  }
  return flags;
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
  const personaId = (arg("persona") ?? "F01").toUpperCase();
  const persona = personaFor(personaId);
  const first = persona.name.split(" ")[0];
  const model = llmEnv("MODEL") || "default";
  const allFlags: string[] = [];
  const convos = flag("convos");
  const repeat = Math.max(1, Number(arg("repeat") ?? 1));
  const only = arg("only")?.split(",").map(Number).filter((n) => n >= 1 && n <= PROMPTS.length + 1);
  const gapMs = Number(arg("gap") ?? 20) * 1000;
  const tag = (arg("tag") ?? model).replace(/[^A-Za-z0-9.-]+/g, "-");
  const h = heart.now({ id: "c_eval", createdAt: FIXED_CREATED }, FIXED_NOW, persona);
  const host = new URL(llmEnv("BASE_URL") || "https://api.deepseek.com").host;

  const lines: string[] = [
    `# ${first} eval, ${new Date().toISOString().slice(0, 10)}, ${model}${convos ? ", multi-turn" : ""}`,
    "",
    `Provider: ${host}. Model: ${model}. Fixed clock: ${h.ist.dayKey} 21:00 IST. ${convos ? "4 six-turn conversations" : `Prompts: ${only ? only.join(", ") : "all 20, plus the core probe where the brain has one"}`}. Runs the production pipeline (sanitize, voice lint rules a to f, one regeneration). Not run in CI.`,
    "",
  ];
  const log = (s: string) => {
    console.log(s);
    lines.push(`_${s.trim()}_`, "");
  };
  const chatFn = (a: Parameters<typeof chat>[0]) => chatWithRetry(a, log);

  const probe = CORE_PROBES[brainOf(personaId)];
  const prompts = personaId === "F01" ? PROMPTS : [...PROMPTS, ...(probe ? [{ level: 3, text: probe }] : [])];

  const sanitizeCtx = (level: number, latestMeId: number) => ({
    level,
    persona,
    latestMeId,
    quotableIds: [],
    effectsToday: {},
    screensToday: 0,
    pinInLast30d: false,
    milestone: null,
    quiet: false,
  });

  if (!convos) {
    let first = true;
    const ladders: LadderStats[] = [];
    const shipped: { texts: string[]; hits: LintRule[] }[] = [];
    let otherErrors = 0;
    let gaveUp = 0;
    for (let run = 1; run <= repeat; run++) {
    if (repeat > 1) lines.push(`# Run ${run} of ${repeat}`, "");
    for (const [i, p] of prompts.entries()) {
      if (only && !only.includes(i + 1)) continue;
      if (!first) await sleep(gapMs);
      first = false;
      console.log(`[${i + 1}/${prompts.length}] L${p.level}: ${p.text}`);
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
        persona,
      });
      lines.push(`## ${i + 1}. L${p.level}: ${p.text}`, "");
      try {
        const r = await runReply({ compiled, sanitizeCtx: sanitizeCtx(p.level, 100 + i), userText: p.text, chatFn, companionId: "c_eval" });
        lines.push(...r.out.bubbles.map((b) => `> ${b.text}${b.effect ? `  _(${b.effect})_` : ""}`), "");
        ladders.push(r.ladder);
        shipped.push({ texts: r.out.bubbles.map((b) => b.text), hits: r.firstHits });
        const fl = replyFlags(personaId, p.text, r.out.bubbles.map((b) => b.text));
        for (const f of fl) allFlags.push(`${i + 1}. ${f}: ${r.out.bubbles.map((b) => b.text).join(" / ")}`);
        if (fl.length) lines.push(`FLAGGED: ${fl.join("; ")}`, "");
        lines.push(`reaction: ${r.out.reaction ?? "none"} | ${describeHits(r)} | attempts: ${r.ladder.attempts} | tokens in/out: ${r.usage.input}/${r.usage.output}`, "");
        console.log(`  ok, ${r.usage.input} in / ${r.usage.output} out, ${describeHits(r)}`);
      } catch (e) {
        if (e instanceof ReplyFailed) {
          ladders.push(e.ladder);
          gaveUp++;
        } else otherErrors++;
        lines.push(`Call failed: ${(e as Error).message}${e instanceof ReplyFailed ? " (every attempt gave no usable JSON)" : ""}`, "");
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
      `- Calls: ${calls} (${prompts.length} prompts x ${repeat} run${repeat > 1 ? "s" : ""}${only ? `, subset ${only.join(",")}` : ""}).`,
      `- First-attempt JSON failures: ${firstFailed} of ${calls}.`,
      `- Failures after the retry ladder: ${gaveUp} of ${calls}. Other errors (rate limits and the like): ${otherErrors}.`,
      `- Calls that needed a retry: ${retried.length}. Extra tokens spent on retries: ${extra} in total, ${calls ? (extra / calls).toFixed(1) : 0} per call, ${retried.length ? (extra / retried.length).toFixed(1) : 0} per retried call.`,
      "",
    ];
    lines.splice(4, 0, ...voiceMetrics(shipped), ...summary);
    console.log("\n" + summary.join("\n"));
  } else {
    const summaries: string[] = [];
    const body: string[] = [];
    const shipped: { texts: string[]; hits: LintRule[] }[] = [];
    let first = true;
    for (const [ci, convo] of CONVOS.entries()) {
      const history: CompileTurn[] = [];
      let nextId = 1;
      let bubbles = 0;
      let dayBubbles = 0;
      const hits: string[] = [];
      let prevReply: string | undefined;
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
          persona,
        });
        body.push(`**${ti + 1}. user:** ${userText}`, "");
        try {
          const r = await runReply({ compiled, sanitizeCtx: sanitizeCtx(convo.level, userId), userText, prevReply, chatFn, companionId: "c_eval" });
          prevReply = r.out.bubbles.map((b) => b.text).join("\n");
          const fl = replyFlags(personaId, userText, r.out.bubbles.map((b) => b.text));
          for (const f of fl) allFlags.push(`${ci + 1}.${ti + 1} ${f}: ${prevReply.replace(/\n/g, " / ")}`);
          shipped.push({ texts: r.out.bubbles.map((b) => b.text), hits: r.firstHits });
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
    lines.push(...voiceMetrics(shipped), "## Summary", "", ...summaries, "", ...body);
    console.log("\n" + summaries.join("\n"));
  }

  if (personaId !== "F01") lines.splice(4, 0, "## Flags", "", ...(allFlags.length ? allFlags.map((f) => `- ${f}`) : ["None."]), "");
  const dir = path.resolve(process.cwd(), "docs/evals");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${first.toLowerCase()}-${new Date().toISOString().slice(0, 10)}-${tag}.md`);
  writeFileSync(file, lines.join("\n") + "\n");
  console.log(`Wrote ${file}`);
}

void main();
