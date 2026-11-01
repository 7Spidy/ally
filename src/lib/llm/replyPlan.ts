/**
 * Which user message a live reply answers, and whether its history ends in her
 * own bubbles (a message sent while the last reply was still in flight). Pure.
 */

export interface PlanRow {
  id: number;
  who: "me" | "them";
  in_reply_to: number | null;
}

export interface ReplyPlan {
  /** User message this reply answers. Greater than claimedId when newer user rows exist with nothing of hers after them. */
  answerId: number;
  /** Highest user message id in the fetched history. */
  seenUpTo: number;
  /** Non-null when the history ends in her bubbles (a queued message sent mid-reply). */
  followUp: { unansweredIds: number[] } | null;
}

/** `history` is ascending by id. */
export function planReply(history: PlanRow[], claimedId: number): ReplyPlan {
  const meIds = history.filter((m) => m.who === "me").map((m) => m.id);
  const seenUpTo = meIds.length ? Math.max(...meIds) : claimedId;

  let start = history.length;
  while (start > 0 && history[start - 1].who === "them") start--;
  const trailing = history.slice(start);

  if (!trailing.length) return { answerId: seenUpTo, seenUpTo, followUp: null };

  const replied = trailing.flatMap((m) => (m.in_reply_to === null ? [] : [m.in_reply_to]));
  const R = replied.length ? Math.max(...replied) : null;
  const unansweredIds = R === null ? [claimedId] : meIds.filter((id) => id < trailing[0].id && id > R);
  return { answerId: claimedId, seenUpTo, followUp: { unansweredIds } };
}
