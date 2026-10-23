/**
 * "Jumbo" emoji: a message that is nothing but one to three emoji renders
 * large with no bubble, as in iMessage. Pure; used by MessageList for both
 * sides of the chat, with no gating, since it is only a look.
 */

export const JUMBO_MAX = 3;

const PICTO = /\p{Extended_Pictographic}/u;
const FLAG = /^\p{Regional_Indicator}{2}$/u;
const KEYCAP = /^[0-9#*]\uFE0F?\u20E3$/u;

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

function isEmojiGrapheme(g: string): boolean {
  return PICTO.test(g) || FLAG.test(g) || KEYCAP.test(g);
}

/** True when `text` is 1 to JUMBO_MAX emoji and whitespace only. */
export function isJumboEmoji(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const parts = graphemes(t).filter((g) => g.trim() !== "");
  if (parts.length === 0 || parts.length > JUMBO_MAX) return false;
  return parts.every(isEmojiGrapheme);
}
