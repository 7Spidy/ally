import { COPY } from "@/lib/copy";
import { HELPLINES } from "@/lib/safety";
import styles from "./ResourceCard.module.css";

/** A system card (not a bubble) with the three numbers as tel: links. Never blocks the composer. */
export function ResourceCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className={styles.card} aria-labelledby="resourceHeading" data-testid="resource-card">
      <h2 id="resourceHeading" className={styles.heading}>
        {COPY.live.resourceHeading}
      </h2>
      <p className={styles.body}>{COPY.live.resourceBody}</p>
      <a className={styles.link} href={`tel:${HELPLINES.teleManas}`}>
        {COPY.live.resourceTeleManas}
      </a>
      <a className={styles.link} href={`tel:${HELPLINES.iCall}`}>
        {COPY.live.resourceICall}
      </a>
      <a className={styles.link} href={`tel:${HELPLINES.emergency}`}>
        {COPY.live.resourceEmergency}
      </a>
      <button type="button" className={styles.dismiss} onClick={onDismiss}>
        {COPY.live.resourceDismiss}
      </button>
    </section>
  );
}
