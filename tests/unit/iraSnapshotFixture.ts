import { compile, type CompileCtx } from "@/lib/llm/compile";
import * as heart from "@/lib/heart";
import { F01, type Persona } from "@/personas/persona";

/** Fixed clock and history for the Ira prompt regression (B4 step 0). Tue 2026-05-12 10:00 IST. */
const NOW = Date.UTC(2026, 4, 12, 4, 30);

/** The RIGHT NOW clock line (double-send change). The stored snapshots predate it; system and stablePrefix are unaffected. */
const CLOCK_LINE = /Your local time: [^\n]*never contradict it\.\n/;
const withoutClock = (c: ReturnType<typeof compile>): ReturnType<typeof compile> => ({
  ...c,
  volatile: c.volatile.replace(CLOCK_LINE, ""),
  messages: c.messages.map((m) => ({ ...m, content: m.content.replace(CLOCK_LINE, "") })),
});

export const IRA_SNAPSHOT_LEVELS = [1, 3, 5, 6] as const;

/** Fixed-clock prompt snapshot for any persona (B5 step 0 generalises the Ira fixture). */
export function promptSnapshot(persona: Persona) {
  const H = heart.now({ id: "c_snapshot", createdAt: NOW - 40 * 86400000 }, NOW, persona);
  const out: Record<string, ReturnType<typeof compile>> = {};
  for (const level of IRA_SNAPSHOT_LEVELS) {
    const ctx: CompileCtx = {
      level,
      mode: "reply",
      userName: "Riya",
      heart: H,
      milestone: null,
      facts: [{ id: 1, category: "work", fact: "Works at a bank" }],
      weekSummaries: [{ key: "2026-05-10", summary: "A busy week." }],
      daySummaries: [{ key: "2026-05-11", summary: "Talked about a deadline." }],
      history: [
        { id: 1, who: "me", text: "hey, long day" },
        { id: 2, who: "them", text: "hey you 🙂 what happened?" },
        { id: 3, who: "me", text: "meetings all day, third coffee already" },
      ],
      coolOff: false,
      safetyMode: false,
      lowEffort: false,
      persona,
    };
    out[`L${level}`] = withoutClock(compile(ctx));
  }
  return out;
}

export const iraSnapshot = () => promptSnapshot(F01);
