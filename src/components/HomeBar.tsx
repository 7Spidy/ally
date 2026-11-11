"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Entitlement } from "@/state/schema";
import { trialDaysLeft } from "@/lib/entitlement";
import { COPY, fill } from "@/lib/copy";
import { CHIP_THRESHOLD } from "@/lib/config";
import styles from "./HomeBar.module.css";

/** The "Free trial, N days left" chip text. */
export function trialChipText(e: Entitlement): string {
  const n = trialDaysLeft(e);
  if (n <= 0) return COPY.home.chipTrialLast;
  if (n === 1) return COPY.home.chipTrialOne;
  return fill(COPY.home.chipTrial, { n });
}

/**
 * Home top bar, spec §10.3: the trial and chats-left chips, the logo, the monogram.
 * Both chips show during the trial only and open the plans screen; a paid plan
 * shows neither.
 */
export function HomeBar({ entitlement, displayName }: { entitlement: Entitlement; displayName: string }) {
  const router = useRouter();
  const onTrial = entitlement.plan === "trial";
  const left = entitlement.chatsLeftToday;
  const showChats = onTrial && left !== null && left <= CHIP_THRESHOLD;

  return (
    <div className={styles.bar}>
      {onTrial ? (
        <div className={styles.chips}>
          <button type="button" className={styles.chip} data-testid="trial-chip" onClick={() => router.push("/plans?from=trial")}>
            {trialChipText(entitlement)}
          </button>
          {showChats && (
            <button type="button" className={styles.chip} data-testid="chats-chip" onClick={() => router.push("/plans?from=chats")}>
              {fill(COPY.home.chipFreeLeft, { n: left })}
            </button>
          )}
        </div>
      ) : (
        <span />
      )}
      <Image src="/assets/logo/ally-logo.png" alt="Ally" width={34} height={34} className={styles.logo} />
      <button
        type="button"
        className={styles.monogram}
        aria-label="Settings"
        onClick={() => router.push("/settings")}
      >
        {(displayName || "?")[0].toUpperCase()}
      </button>
    </div>
  );
}
