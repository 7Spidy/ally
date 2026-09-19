"use client";

import { useRouter } from "next/navigation";
import { useAlly } from "@/state/useAlly";
import { useSheet } from "@/state/useSheet";
import { Sheet } from "@/components/Sheet";
import { COPY } from "@/lib/copy";
import styles from "./LeaveSheet.module.css";

/**
 * Opened by the onboarding layout's round-two X button (not by this work
 * area) whenever the user tries to leave mid-round-two. Spec §9.1, §6
 * 'leave sheet'.
 */
export function LeaveSheet() {
  const { dispatch } = useAlly();
  const { closeSheet } = useSheet();
  const router = useRouter();

  function handleKeepGoing() {
    closeSheet();
  }

  function handleLeave() {
    dispatch({ type: "LEAVE_ROUND2" });
    closeSheet();
    router.push("/home");
  }

  return (
    <Sheet labelledBy="leaveSheetHeading">
      <h2 id="leaveSheetHeading" className={styles.heading}>
        {COPY.leaveSheet.heading}
      </h2>
      <p className={styles.body}>{COPY.leaveSheet.body}</p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={handleKeepGoing}>
          {COPY.leaveSheet.keepGoing}
        </button>
        <button type="button" className="btn quiet" onClick={handleLeave}>
          {COPY.leaveSheet.leave}
        </button>
      </div>
    </Sheet>
  );
}
