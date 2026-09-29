/**
 * B2 manual eval, not CI. Sends 20 fixed prompts (7 at L1, 7 at L3, 6 at L5)
 * through compile() and the real model, and writes the raw and sanitized
 * outputs to docs/evals/ira-<date>.md for the owner to read.
 *
 * Run: npm run eval:ira   (needs XAI_API_KEY; XAI_MODEL and XAI_BASE_URL optional)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compile } from "@/lib/llm/compile";
import { LIVE_OUT_SCHEMA, parseLiveOut, sanitize } from "@/lib/llm/contract";
import { chat } from "@/lib/llm/xai";
import * as heart from "@/lib/heart";

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

const NOW = Date.UTC(2026, 4, 12, 15, 30); // Tue 2026-05-12, 21:00 IST
const CREATED = NOW - 70 * 86400000;

async function main() {
  if (!process.env.XAI_API_KEY) {
    console.error("XAI_API_KEY is not set.");
    process.exit(1);
  }
  const h = heart.now({ id: "c_eval", createdAt: CREATED }, NOW);
  const lines: string[] = [
    `# Ira eval, ${new Date(NOW).toISOString().slice(0, 10)}`,
    "",
    `Model: ${process.env.XAI_MODEL || "default"}. Fixed clock: ${h.ist.dayKey} 21:00 IST. Not run in CI.`,
    "",
  ];
  for (const [i, p] of PROMPTS.entries()) {
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
      const res = await chat({ system: c.system, messages: c.messages, schema: LIVE_OUT_SCHEMA, schemaName: "ira_reply", maxTokens: 500, temperature: 0.9, companionId: "c_eval" });
      const out = parseLiveOut(res.content);
      if (!out) {
        lines.push("Unparseable output:", "```", res.content, "```", "");
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
      lines.push(`reaction: ${clean.reaction ?? "none"} | safety: ${clean.safety} | disclosure: ${clean.disclosure} | tokens: ${res.usage.input}/${res.usage.output} (cached ${res.usage.cached})`, "");
    } catch (e) {
      lines.push(`Call failed: ${(e as Error).message}`, "");
    }
  }
  const dir = path.resolve(process.cwd(), "docs/evals");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ira-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(file, lines.join("\n") + "\n");
  console.log(`Wrote ${file}`);
}

void main();
