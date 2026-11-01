import { chat, type ChatArgs, type ChatResult } from "@/lib/llm/llm";
import type { Persona } from "@/personas/persona";

export type ChatFn = (args: ChatArgs) => Promise<ChatResult>;

export interface ProactiveTurn {
  who: "me" | "them";
  text: string;
  at?: number;
}

export interface ProactivePingArgs {
  persona: Persona;
  userName: string;
  history: ProactiveTurn[];
  companionId: string;
  chatFn?: ChatFn;
}

/** Fallback spontaneous in-character pings if LLM is unavailable */
const FALLBACK_PINGS: Record<string, string[]> = {
  F01: [
    "finally done at the studio for the day. how was yours?",
    "was sitting with some tea and wondering how your day went.",
    "came across an interesting design problem earlier and thought of you.",
    "hope the day wasn't too hectic on your end.",
  ],
  F02: [
    "just finished at the pottery wheel. quiet evening here.",
    "hope you got some time to unwind today.",
    "stepping out for a bit. how's everything with you?",
  ],
  F03: [
    "survived clinic duties today haha. what are you up to?",
    "random thought, but hope your day was good!",
    "taking a quick break. how's your evening going?",
  ],
  F04: [
    "taking a slow breather between sessions. how are things on your side?",
    "hope you're finding some quiet time today.",
    "just checking in. hope the day has been kind to you.",
  ],
  F05: [
    "the city traffic was unbelievable today haha. how was your day?",
    "quick check-in. what are you up to tonight?",
  ],
  default: [
    "hey, was just thinking of our conversation earlier. how's your day going?",
    "hope your day has been treating you well. what are you up to?",
    "taking a quick moment. hope things are going smoothly for you.",
  ],
};

function getFallbackPing(templateId: string): string {
  const list = FALLBACK_PINGS[templateId] || FALLBACK_PINGS.default;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx];
}

export async function generateProactivePing({
  persona,
  userName,
  history,
  companionId,
  chatFn = chat,
}: ProactivePingArgs): Promise<{ text: string }> {
  const recentTurns = history.slice(-10);
  const city = persona.engine?.city || "Delhi";
  const work = persona.identity?.work || "Practice";
  const likes = persona.identity?.likes || "daily life";
  const vibe = persona.core?.vibe || "thoughtful companion";

  const system = `You are writing a proactive text message from an AI companion to the user.
Character Name: ${persona.name}
City: ${city}
Work/Context: ${work}
Vibe: ${vibe}
Interests: ${likes}

Task:
The user has been away from the chat for a while. You are reaching out to send a single spontaneous text message.

Rules for your message:
1. Context sync vs. fresh ping:
   - Check the recent message history.
   - If the previous conversation left an open thread, question, or unresolved topic, naturally follow up on it (e.g. asking how that turned out, or following up on what they were doing).
   - If the previous conversation reached a natural conclusion or goodbye, DO NOT awkwardly drag up the old topic. Instead, send a spontaneous in-character message: something you just experienced, worked on, or thought of, or a casual question about what they are up to.
2. In-character authenticity:
   - Sound like a real person texting, not a customer service bot.
   - Use casual punctuation and lowercase cadence matching the persona's speaking voice.
   - NEVER use robotic clichés like "Just checking in on you!", "How can I help you today?", or "I hope this message finds you well."
   - Keep it short: 1 or 2 natural sentences (under 30 words).
3. Output format:
   - Return strictly valid JSON: {"text": "your message here"}`;

  const historyText = recentTurns.length
    ? recentTurns.map((m) => `${m.who === "me" ? userName || "User" : persona.name}: ${m.text}`).join("\n")
    : "(No previous conversation yet)";

  const userPrompt = `User's name: ${userName || "User"}
Recent conversation:
${historyText}

Send your proactive ping message as JSON:`;

  try {
    const result = await chatFn({
      system,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 100,
      temperature: 0.85,
      companionId,
    });

    // Parse JSON
    const content = result.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.text === "string" && parsed.text.trim()) {
        return { text: parsed.text.trim() };
      }
    }
  } catch (err) {
    console.warn("Proactive ping LLM call failed, using fallback:", err);
  }

  return { text: getFallbackPing(persona.id) };
}
