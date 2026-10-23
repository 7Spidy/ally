import type { ScreenKind } from "@/lib/heart";
import type { Effect } from "@/lib/llm/contract";

/** The bubble effects the QA lab can preview or force, in the order it lists them. `screen` is not one: it is a screen effect's carrier. */
export type BubbleEffect = Exclude<Effect, "screen">;

export const BUBBLE_EFFECTS: { id: BubbleEffect; label: string }[] = [
  { id: "soft", label: "Whisper" },
  { id: "loud", label: "Shout" },
  { id: "stop", label: "Pause" },
  { id: "ink", label: "Ink" },
  { id: "pin", label: "Pin" },
  { id: "shake", label: "Shake" },
  { id: "sparkle", label: "Sparkle" },
  { id: "echo", label: "Echo" },
  { id: "bloom", label: "Bloom" },
  { id: "heartbeat", label: "Heartbeat" },
];

export const SCREEN_EFFECTS: { id: ScreenKind; label: string }[] = [
  { id: "confetti", label: "Confetti" },
  { id: "lanterns", label: "Lanterns" },
  { id: "rain", label: "Rain" },
  { id: "petals", label: "Petals" },
  { id: "balloons", label: "Balloons" },
  { id: "fireworks", label: "Fireworks" },
  { id: "shootingstar", label: "Shooting star" },
  { id: "sparkles", label: "Sparkles" },
];

export const PREVIEW_TEXT: Record<BubbleEffect, string> = {
  soft: "this one is said quietly",
  loud: "THIS ONE IS A SHOUT",
  stop: "okay, that took a second to say",
  ink: "a secret, hidden until you swipe",
  pin: "a line worth keeping",
  shake: "i cannot stop laughing",
  sparkle: "you did that, and it was great",
  echo: "and then it just trails off",
  bloom: "i like talking to you",
  heartbeat: "you make my heart do that",
};

/** A unique negative id, so a local preview can never collide with a saved message or an ink-reveal flag. */
let seq = 0;
export function previewId(): number {
  seq += 1;
  return -(Date.now() * 100 + (seq % 100));
}

/** The reactions in this level's palette, once each. */
export function uniqueReactions(palette: string[]): string[] {
  return [...new Set(palette)];
}
