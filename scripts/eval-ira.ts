/**
 * B2 manual eval, not CI. Sends 20 fixed prompts (7 at L1, 7 at L3, 6 at L5)
 * through compile() and the real model, and writes the raw and sanitized
 * outputs to docs/evals/ira-<date>-<tag>.md for the owner to read.
 *
 *   npm run eval:ira -- --only=1,2,18,19 --gap=20 --tag=gpt-oss-120b
 *
 * Reads XAI_API_KEY, XAI_BASE_URL and XAI_MODEL from the environment or
 * .env.local (never printed). Calls run one at a time with a gap (default
 * 20 s) to stay under per-minute token limits; a 429 waits for Retry-After
 * and retries up to 3 times. Provider error bodies are printed and saved.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compile } from "@/lib/llm/compile";
import { LIVE_OUT_SCHEMA, parseLiveOut, sanitize } from "@/lib/llm/contract";
import { chat, XaiError, type ChatResult } from "@/lib/llm/xai";
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

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function callWithRetry(args: Parameters<typeof chat>[0], log: (s: string) => void): Promise<ChatResult> {
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

async function main() {
  if (!process.env.XAI_API_KEY) {
    console.error("XAI_API_KEY is not set (env or .env.local).");
    process.exit(1);
  }
  const model = process.env.XAI_MODEL || "default";
  const only = arg("only")?.split(",").map(Number).filter((n) => n >= 1 && n <= PROMPTS.length);
  const gapMs = Number(arg("gap") ?? 20) * 1000;
  const tag = (arg("tag") ?? model).replace(/[^A-Za-z0-9.-]+/g, "-");
  const h = heart.now({ id: "c_eval", createdAt: FIXED_CREATED }, FIXED_NOW);
  const host = new URL(process.env.XAI_BASE_URL || "https://api.x.ai/v1").host;

  const lines: string[] = [
    `# Ira eval, ${new Date().toISOString().slice(0, 10)}, ${model}`,
    "",
    `Provider: ${host}. Model: ${model}. Fixed clock: ${h.ist.dayKey} 21:00 IST. Prompts: ${only ? only.join(", ") : "all 20"}. Not run in CI.`,
    "",
  ];
  const log = (s: string) => {
    console.log(s);
    lines.push(`_${s.trim()}_`, "");
  };

  let first = true;
  for (const [i, p] of PROMPTS.entries()) {
    if (only && !only.includes(i + 1)) continue;
    if (!first) await sleep(gapMs);
    first = false;
    console.log(`[${i + 1}/${PROMPTS.length}] L${p.level}: ${p.text}`);
    const c = compile({
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
      const res = await callWithRetry({ system: c.system, messages: c.messages, schema: LIVE_OUT_SCHEMA, schemaName: "ira_reply", maxTokens: 500, temperature: 0.9, companionId: "c_eval" }, log);
      const out = parseLiveOut(res.content);
      if (!out) {
        lines.push("Unparseable output:", "```", res.content, "```", "");
        console.log("  unparseable");
        continue;
      }
      const clean = sanitize(out, {
        level: p.level,
        latestMeId: 100 + i,
        quotableIds: [],
        recentUserReactions: [],
        effectsToday: {},
        screensToday: 0,
        pinInLast30d: false,
        milestone: null,
        quiet: false,
      });
      lines.push(...clean.bubbles.map((b) => `> ${b.text}${b.effect ? `  _(${b.effect})_` : ""}`), "");
      lines.push(`reaction: ${clean.reaction ?? "none"} | safety: ${clean.safety} | disclosure: ${clean.disclosure} | tokens in/out: ${res.usage.input}/${res.usage.output} (cached ${res.usage.cached})`, "");
      console.log(`  ok, ${res.usage.input} in / ${res.usage.output} out`);
    } catch (e) {
      const msg = (e as Error).message;
      lines.push(`Call failed: ${msg}`, "");
      console.log(`  FAILED: ${msg}`);
    }
  }
  const dir = path.resolve(process.cwd(), "docs/evals");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ira-${new Date().toISOString().slice(0, 10)}-${tag}.md`);
  writeFileSync(file, lines.join("\n") + "\n");
  console.log(`Wrote ${file}`);
}

void main();
