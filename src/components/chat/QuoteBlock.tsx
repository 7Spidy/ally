import { COPY } from "@/lib/copy";
import styles from "./QuoteBlock.module.css";

/**
 * The earlier message a bubble replies to, above the bubble text. `label` is
 * who wrote it. Tapping it jumps to the original; a deleted original shows a
 * plain note instead of text.
 */
export function QuoteBlock({
  label,
  text,
  color,
  deleted = false,
  onJump,
}: {
  label: string;
  text: string;
  color: string;
  deleted?: boolean;
  onJump?: () => void;
}) {
  const body = (
    <>
      <span className={styles.who}>{label}</span>
      <span className={deleted ? styles.gone : styles.text}>{deleted ? COPY.chat.quoteDeleted : text}</span>
    </>
  );
  if (onJump && !deleted) {
    return (
      <button type="button" className={styles.quote} style={{ borderLeftColor: color }} data-testid="quote" onClick={onJump} onPointerDown={(e) => e.stopPropagation()}>
        {body}
      </button>
    );
  }
  return (
    <blockquote className={styles.quote} style={{ borderLeftColor: color }} data-testid="quote">
      {body}
    </blockquote>
  );
}
