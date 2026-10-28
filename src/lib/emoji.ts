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

/** True when any grapheme of `text` is an emoji. A jumbo emoji-only bubble counts. */
export function hasEmoji(text: string): boolean {
  return graphemes(text).some(isEmojiGrapheme);
}

/** Emoji-less replies allowed in a row before the floor fires. */
export const EMOJI_MAX_DRY = 2;

/**
 * The emoji floor: true when the persona's last EMOJI_MAX_DRY replies had no
 * emoji, so this reply must carry one. A reply is a run of consecutive "them"
 * turns; any "me" turn ends it. A reply with a safety bubble stops the count,
 * and when it is the newest reply nothing is due (a crisis may be in progress).
 */
export function emojiDue(history: { who: "them" | "me"; text: string; safety?: boolean }[]): boolean {
  const replies: { text: string; safety?: boolean }[][] = [];
  let open = false;
  for (const t of history) {
    if (t.who === "me") {
      open = false;
      continue;
    }
    if (open) replies[replies.length - 1].push(t);
    else replies.push([t]);
    open = true;
  }
  let dry = 0;
  for (let i = replies.length - 1; i >= 0; i--) {
    const r = replies[i];
    if (r.some((b) => b.safety)) {
      if (i === replies.length - 1) return false;
      break;
    }
    if (r.some((b) => hasEmoji(b.text))) break;
    dry++;
  }
  return dry >= EMOJI_MAX_DRY;
}
