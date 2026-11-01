import { describe, expect, it } from "vitest";
import { planReply, type PlanRow } from "@/lib/llm/replyPlan";

const me = (id: number): PlanRow => ({ id, who: "me", in_reply_to: null });
const them = (id: number, inReplyTo: number | null): PlanRow => ({ id, who: "them", in_reply_to: inReplyTo });

describe("planReply", () => {
  it("the production case: 586 was sent while the reply to 585 was in flight", () => {
    const history = [me(584), them(583, 582), me(585), me(586), them(587, 585), them(588, 585)].sort((a, b) => a.id - b.id);
    expect(planReply(history, 586)).toEqual({ answerId: 586, seenUpTo: 586, followUp: { unansweredIds: [586] } });
  });

  it("promotion: the history ends in a newer user row, so the reply answers that one", () => {
    const history = [me(584), them(585, 584), me(586), me(587)];
    expect(planReply(history, 586)).toEqual({ answerId: 587, seenUpTo: 587, followUp: null });
  });

  it("the normal case changes nothing", () => {
    const history = [them(1, null), me(2), them(3, 2), me(4)];
    expect(planReply(history, 4)).toEqual({ answerId: 4, seenUpTo: 4, followUp: null });
  });

  it("three unanswered messages give all three ids", () => {
    const history = [me(10), me(11), me(12), me(13), them(14, 10)];
    expect(planReply(history, 13).followUp).toEqual({ unansweredIds: [11, 12, 13] });
  });

  it("legacy rows with a null in_reply_to treat only the claimed message as unanswered", () => {
    const history = [me(10), me(11), them(12, null), them(13, null)];
    expect(planReply(history, 11)).toEqual({ answerId: 11, seenUpTo: 11, followUp: { unansweredIds: [11] } });
  });

  it("her bubbles already answering the newest user message give an empty list", () => {
    const history = [me(10), me(11), them(12, 11)];
    expect(planReply(history, 11)).toEqual({ answerId: 11, seenUpTo: 11, followUp: { unansweredIds: [] } });
  });

  it("falls back to the claimed id when the window holds no user rows", () => {
    expect(planReply([them(1, null)], 7)).toEqual({ answerId: 7, seenUpTo: 7, followUp: { unansweredIds: [7] } });
  });
});
