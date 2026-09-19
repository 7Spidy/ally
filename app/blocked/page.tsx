import styles from "./page.module.css";

/** No back button, no retry field, no link out. A closed door, not a scolding. */
export default function BlockedPage() {
  return (
    <div className={styles.wrap}>
      <h1 className={styles.heading}>Ally is for adults.</h1>
      <p className={`sub ${styles.body}`}>Come back when you&apos;re eighteen.</p>
    </div>
  );
}
