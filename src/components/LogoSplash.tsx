import Image from "next/image";
import styles from "./LogoSplash.module.css";

/** The static logo splash: boot's returning splash, and what stands in for a blank screen while state loads. */
export function LogoSplash() {
  return (
    <div className={styles.splash}>
      <Image src="/assets/logo/ally-logo.png" alt="" width={120} height={120} className={styles.logo} priority />
      <p className={`wordmark ${styles.wordmark}`}>Ally</p>
      <p className={`meta ${styles.footer}`}>Ally is an AI. Every character here is fictional.</p>
    </div>
  );
}
