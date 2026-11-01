import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { compile, type CompileCtx, type CompileTurn } from "@/lib/llm/compile";
import { FOLLOWUP_REACTIONS, LIVE_OUT_SCHEMA, LIVE_OUT_SCHEMA_FOLLOWUP, parseLiveOut, sanitize, type LiveOut, type SanitizeCtx } from "@/lib/llm/contract";
import { lintReply } from "@/lib/llm/lint";
import { ReplyFailed, runReply, type ChatFn } from "@/lib/llm/reply";
import { planReply, type PlanRow } from "@/lib/llm/replyPlan";
import * as heart from "@/lib/heart";
import { F01, paletteFor } from "@/personas/persona";
import { promptSnapshot } from "./iraSnapshotFixture";

const OPENER = "The chat has just opened";
const NOW = Date.UTC(2026, 4, 12, 4, 30); // Tue 2026-05-12 10:00 IST
const H = heart.now({ id: "c_x", createdAt: NOW - 40 * 86400000 }, NOW, F01);

function ctx(level: number, over: Partial<CompileCtx> = {}): CompileCtx {
  return { level, mode: "reply", userName: "Riya", heart: H, milestone: null, facts: [], weekSummaries: [], daySummaries: [], history: [{ id: 5, who: "me", text: "hello" }], coolOff: false, safetyMode: false, lowEffort: false, persona: F01, ...over };
}

const lastContent = (c: ReturnType<typeof compile>) => c.messages[c.messages.length - 1].content;
const istAt = (y: number, mo: number, d: number, h: number, mi: number) => heart.istNow(Date.UTC(y, mo - 1, d, h, mi) - 5.5 * 3600000);

describe("clockLine", () => {
  it("names the day part by IST hour", () => {
    const cases: [number, number, string][] = [
      [4, 59, "late night"], [5, 0, "early morning"], [7, 59, "early morning"], [8, 0, "morning"], [11, 59, "morning"], [12, 0, "afternoon"],
      [16, 59, "afternoon"], [17, 0, "evening"], [20, 59, "evening"], [21, 0, "night"], [23, 59, "night"], [0, 0, "late night"],
    ];
    for (const [h, m, part] of cases) expect(heart.clockLine(istAt(2026, 5, 12, h, m)), `${h}:${m}`).toMatch(new RegExp(`\\(${part}\\)\\.$`));
  });
  it("is the exact string for 2026-10-31T18:17Z", () => {
    expect(heart.clockLine(heart.istNow(Date.UTC(2026, 9, 31, 18, 17)))).toBe("Your local time: 11:47 pm, Saturday (night).");
  });
  it("uses 12-hour time with zero-padded minutes, and the IST calendar day", () => {
    expect(heart.clockLine(istAt(2026, 5, 12, 0, 5))).toBe("Your local time: 12:05 am, Tuesday (late night).");
    expect(heart.clockLine(istAt(2026, 5, 12, 12, 0))).toBe("Your local time: 12:00 pm, Tuesday (afternoon).");
  });
  it("rides in the volatile block right after RIGHT NOW, in both modes, never in the system prompt", () => {
    for (const mode of ["reply", "opener"] as const) {
      const c = compile(ctx(1, mode === "opener" ? { mode, history: [] } : { mode }));
      expect(c.volatile.split("\n").slice(0, 2)).toEqual(["RIGHT NOW", "Your local time: 10:00 am, Tuesday (morning). Time sets context; mention it only when it matters, and never contradict it."]);
      expect(c.system).not.toContain("Your local time");
      expect(c.stablePrefix).not.toContain("Your local time");
    }
  });
  it("leaves the stable prefix unchanged at another time", () => {
    const later = Date.UTC(2026, 4, 14, 17, 17);
    const h2 = heart.now({ id: "c_x", createdAt: NOW - 40 * 86400000 }, later, F01);
    for (const level of [1, 2, 3, 4, 5, 6]) expect(compile(ctx(level, { heart: h2 })).stablePrefix).toBe(compile(ctx(level)).stablePrefix);
  });
  it("leaves the stable prefix byte-identical to the pre-change snapshot at each level", () => {
    const before = JSON.parse(readFileSync(path.join(__dirname, "__snapshots__", "women-prompts-before.json"), "utf8")).F01;
    const now = promptSnapshot(F01);
    for (const k of ["L1", "L3", "L5", "L6"] as const) {
      expect(now[k].stablePrefix, k).toBe(before[k].stablePrefix);
      expect(now[k].system, k).toBe(before[k].system);
    }
  });
});

describe("compile, follow-up framing", () => {
  const turn = (id: number, who: "me" | "them", text: string): CompileTurn => ({ id, who, text });
  const production: CompileTurn[] = [turn(585, "me", "I did not know what it meant. I'm sleepy rn"), turn(586, "me", "Talk to you tomorrow?"), turn(587, "them", "sleepy but still up…"), turn(588, "them", "go sleep properly…")];

  it("replays the production sequence: a follow-up quoting [#586], never the opener line, with the local time", () => {
    const rows: PlanRow[] = production.map((t) => ({ id: t.id, who: t.who, in_reply_to: t.who === "them" ? 585 : null }));
    const plan = planReply(rows, 586);
    const unanswered = production.filter((t) => plan.followUp?.unansweredIds.includes(t.id));
    const at = Date.UTC(2026, 9, 31, 18, 17, 30);
    const c = compile(ctx(1, { history: production, heart: heart.now({ id: "c_x", createdAt: at - 40 * 86400000 }, at, F01), followUp: { unanswered, allowEmpty: true } }));
    const last = lastContent(c);
    expect(last).toContain('[#586] "Talk to you tomorrow?"');
    expect(last).not.toContain(OPENER);
    expect(last).toContain("Your local time: 11:47 pm, Saturday (night).");
  });

  it("opener mode still opens with the opener line", () => {
    const c = compile(ctx(1, { mode: "opener", history: [] }));
    expect(lastContent(c)).toContain(`(${OPENER}. Write your first message.)`);
  });

  it("reply mode never carries the opener line, even when the history ends in her bubbles", () => {
    const c = compile(ctx(1, { history: [turn(1, "me", "hi"), turn(2, "them", "hey")] }));
    expect(c.messages.map((m) => m.content).join("\n")).not.toContain(OPENER);
    expect(lastContent(c)).toContain("(Continue from where the conversation is. No greeting, no new topic.)");
  });

  it("quotes each unanswered message as [#id] with its text, edits and replies included", () => {
    const unanswered: CompileTurn[] = [turn(10, "me", "one"), { ...turn(11, "me", "two"), edited: true }, { ...turn(12, "me", "three"), quote: { who: "them", text: "earlier line" } }];
    const last = lastContent(compile(ctx(2, { history: [...unanswered, turn(13, "them", "reply")], followUp: { unanswered, allowEmpty: false } })));
    expect(last).toContain('[#10] "one"');
    expect(last).toContain('[#11] "(edited) two"');
    expect(last).toContain('[#12] "(replying to your earlier message: "earlier line") three"');
  });

  it("allowEmpty changes the wording", () => {
    const unanswered = [turn(10, "me", "one")];
    const history = [turn(10, "me", "one"), turn(11, "them", "reply")];
    const yes = lastContent(compile(ctx(1, { history, followUp: { unanswered, allowEmpty: true } })));
    const no = lastContent(compile(ctx(1, { history, followUp: { unanswered, allowEmpty: false } })));
    expect(yes).toContain("react only and send no bubbles (an empty bubbles array overrides the bubble count in the OUTPUT CONTRACT for this reply only)");
    expect(yes).not.toContain("send one short bubble");
    expect(no).toContain("send one short bubble");
    expect(no).not.toContain("send no bubbles");
    for (const t of [yes, no]) {
      expect(t).toContain("They sent this while you were still replying:");
      expect(t).toContain("Never greet, never restart the day, never start a new topic.");
    }
  });

  it("drops the emoji-due line in follow-up mode but keeps the reaction floor", () => {
    const history = [turn(1, "me", "a"), turn(2, "them", "no emoji here"), turn(3, "me", "b"), turn(4, "them", "none here either"), turn(5, "me", "c"), turn(6, "them", "still none")];
    expect(lastContent(compile(ctx(1, { history })))).toContain("Emoji: your last two replies had none");
    const f = lastContent(compile(ctx(1, { history, followUp: { unanswered: [turn(5, "me", "c")], allowEmpty: true } })));
    expect(f).not.toContain("Emoji: your last two replies had none");
    expect(f).toContain("Reaction: you have not reacted");
  });
});

describe("contract, follow-up", () => {
  const empty = (over: Record<string, unknown> = {}) => JSON.stringify({ bubbles: [], reaction: "👍", quoteId: null, screen: null, riskLevel: "none", ageClaimUnder18: false, disclosure: false, mutualVulnerability: false, abusive: false, ...over });

  it("rejects empty or blank bubbles by default and accepts them with allowEmpty", () => {
    expect(parseLiveOut(empty())).toBeNull();
    expect(parseLiveOut(empty({ bubbles: [{ text: "  ", effect: null }] }))).toBeNull();
    expect(parseLiveOut(empty(), { allowEmpty: true })?.bubbles).toEqual([]);
    expect(parseLiveOut(empty({ bubbles: [{ text: "   ", effect: null }, "\n"] }), { allowEmpty: true })?.bubbles).toEqual([]);
  });

  it("rejects an empty reply that carries a safety or age flag, even with allowEmpty", () => {
    expect(parseLiveOut(empty({ riskLevel: "concern" }), { allowEmpty: true })).toBeNull();
    expect(parseLiveOut(empty({ riskLevel: "acute" }), { allowEmpty: true })).toBeNull();
    expect(parseLiveOut(empty({ ageClaimUnder18: true }), { allowEmpty: true })).toBeNull();
  });

  it("still parses a normal reply the same way with allowEmpty", () => {
    const text = empty({ bubbles: [{ text: "ok", effect: null }] });
    expect(parseLiveOut(text, { allowEmpty: true })).toEqual(parseLiveOut(text));
  });

  it("the schema variant differs only in bubbles.minItems", () => {
    expect(LIVE_OUT_SCHEMA_FOLLOWUP.properties.bubbles.minItems).toBe(0);
    expect(LIVE_OUT_SCHEMA.properties.bubbles.minItems).toBe(1);
    const restored = { ...LIVE_OUT_SCHEMA_FOLLOWUP, properties: { ...LIVE_OUT_SCHEMA_FOLLOWUP.properties, bubbles: { ...LIVE_OUT_SCHEMA_FOLLOWUP.properties.bubbles, minItems: 1 } } };
    expect(restored).toEqual(LIVE_OUT_SCHEMA);
  });

  describe("forced reaction", () => {
    const sctx = (level: number, over: Partial<SanitizeCtx> = {}): SanitizeCtx => ({ level, persona: F01, latestMeId: 10, quotableIds: [], effectsToday: {}, screensToday: 0, pinInLast30d: false, milestone: null, quiet: false, allowEmpty: true, ...over });
    const bare = (reaction: string | null): LiveOut => ({ bubbles: [], reaction, quoteId: null, screen: null, riskLevel: "none", ageClaimUnder18: false, disclosure: false, mutualVulnerability: false, abusive: false });
    let logs: string[] = [];
    beforeEach(() => {
      logs = [];
      vi.spyOn(console, "info").mockImplementation((s: unknown) => void logs.push(String(s)));
    });
    afterEach(() => vi.restoreAllMocks());

    it("picks the first of the preference order that is in the level's palette", () => {
      for (const level of [1, 2, 3, 4, 5, 6]) {
        const palette = paletteFor(level, F01);
        const expected = FOLLOWUP_REACTIONS.find((r) => palette.includes(r)) ?? palette[0];
        expect(sanitize(bare(null), sctx(level)).reaction, `L${level}`).toBe(expected);
      }
      expect(paletteFor(1, F01)).toContain("😊");
      expect(sanitize(bare(null), sctx(1)).reaction).toBe("😊");
      expect(logs.some((l) => l.includes("llm.followup_reaction_forced"))).toBe(true);
    });

    it("keeps a reaction the model chose, and does nothing without allowEmpty or with bubbles", () => {
      expect(sanitize(bare("👍"), sctx(1)).reaction).toBe("👍");
      expect(sanitize(bare(null), sctx(1, { allowEmpty: false })).reaction).toBeNull();
      expect(sanitize({ ...bare(null), bubbles: [{ text: "hi", effect: null }] }, sctx(1)).reaction).toBeNull();
    });
  });
});

describe("runReply, allowEmpty", () => {
  const compiled = { system: "SYS", stablePrefix: "SYS", volatile: "", messages: [{ role: "user" as const, content: "[#1] hi" }] };
  const sctx: SanitizeCtx = { persona: F01, level: 1, latestMeId: 1, quotableIds: [], effectsToday: {}, screensToday: 0, pinInLast30d: false, milestone: null, quiet: false, allowEmpty: true };
  const json = (over: Record<string, unknown>) => JSON.stringify({ bubbles: [{ text: "ok", effect: null }], reaction: null, quoteId: null, screen: null, riskLevel: "none", ageClaimUnder18: false, disclosure: false, mutualVulnerability: false, abusive: false, ...over });
  const scripted = (...contents: string[]) => {
    const schemas: unknown[] = [];
    const fn: ChatFn = async (args) => {
      schemas.push(args.schema);
      return { content: contents[Math.min(schemas.length - 1, contents.length - 1)], model: "m", usage: { input: 10, output: 5, cached: 0 }, latencyMs: 1 };
    };
    return { fn, schemas };
  };
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns an empty follow-up in one call, with no lint and no regeneration", async () => {
    const s = scripted(json({ bubbles: [], reaction: "👍" }));
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "second one", chatFn: s.fn, allowEmpty: true });
    expect(s.schemas).toEqual([LIVE_OUT_SCHEMA_FOLLOWUP]);
    expect(r).toMatchObject({ regenerated: false, firstHits: [], secondHits: null });
    expect(r.out.bubbles).toEqual([]);
    expect(r.out.reaction).toBe("👍");
  });

  it("forces a reaction when the model sent neither bubbles nor a reaction", async () => {
    const s = scripted(json({ bubbles: [], reaction: null }));
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "second one", chatFn: s.fn, allowEmpty: true });
    expect(r.out.bubbles).toEqual([]);
    expect(r.out.reaction).toBe("😊");
  });

  it("default callers are unaffected: the strict schema, and an empty reply goes through the retry ladder", async () => {
    const s = scripted(json({ bubbles: [], reaction: "👍" }));
    await expect(runReply({ compiled, sanitizeCtx: { ...sctx, allowEmpty: undefined }, userText: "hi", chatFn: s.fn })).rejects.toBeInstanceOf(ReplyFailed);
    expect(s.schemas.every((x) => x === LIVE_OUT_SCHEMA)).toBe(true);
    expect(s.schemas.length).toBeGreaterThan(1);
  });

  it("an empty reply that carries a safety flag is retried, not shipped", async () => {
    const s = scripted(json({ bubbles: [], riskLevel: "concern" }), json({ bubbles: [{ text: "i'm here. talk to me", effect: null }], riskLevel: "concern" }));
    const r = await runReply({ compiled, sanitizeCtx: sctx, userText: "i can't do this", chatFn: s.fn, allowEmpty: true });
    expect(s.schemas).toHaveLength(2);
    expect(r.out.bubbles).toHaveLength(1);
  });
});

describe("lint SIGN_OFF", () => {
  const closed: Pick<LiveOut, "bubbles"> = { bubbles: [{ text: "long day. the geyser is on strike again.", effect: null }] };
  it("treats the new sign-offs as sign-offs, so rule e does not fire", () => {
    for (const u of ["Talk to you tomorrow?", "talk to you later", "talk to u tomorrow", "talk to u tmrw", "talk to you tmr", "ttyt", "TTYT!", "see you tomorrow", "see u tmrw", "catch ya later", "catch you later", "see ya tomorrow"]) {
      expect(lintReply(closed, u, { prevReply: "noted." }), u).toEqual([]);
    }
  });
  it("still fires on an ordinary message", () => {
    expect(lintReply(closed, "i talk to you a lot", { prevReply: "noted." })).toEqual(["e"]);
    expect(lintReply(closed, "hi", { prevReply: "noted." })).toEqual(["e"]);
  });
});
