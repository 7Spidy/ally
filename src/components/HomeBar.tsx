"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Ledger } from "@/state/schema";
import { freeLeft, passActive } from "@/lib/ledger";
import { formatTimeIST } from "@/lib/clock";
import { COPY, fill } from "@/lib/copy";
import { CHIP_THRESHOLD } from "@/lib/config";
import styles from "./HomeBar.module.css";

/** Home top bar, spec §10.3: the ledger chip, the logo, the monogram. */
export function HomeBar({ ledger, now, displayName }: { ledger: Ledger; now: number; displayName: string }) {
  const router = useRouter();
  const onPass = passActive(ledger, now);
  const n = freeLeft(ledger, now);

  let chip: string | null = null;
  if (onPass) {
    chip = fill(COPY.home.chipPassActive, { time: formatTimeIST((ledger.pass as NonNullable<Ledger["pass"]>).endsAt) });
  } else if (n <= CHIP_THRESHOLD) {
    chip = fill(COPY.home.chipFreeLeft, { n });
  }

  return (
    <div className={styles.bar}>
      {chip ? <span className={styles.chip}>{chip}</span> : <span />}
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
