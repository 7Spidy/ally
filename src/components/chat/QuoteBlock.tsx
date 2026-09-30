import { COPY } from "@/lib/copy";
import styles from "./QuoteBlock.module.css";

/** The earlier user message a bubble replies to, above the bubble text. */
export function QuoteBlock({ text, color }: { text: string; color: string }) {
  return (
    <blockquote className={styles.quote} style={{ borderLeftColor: color }} data-testid="quote">
      <span className={styles.who}>{COPY.chat.quoteYou}</span>
      <span className={styles.text}>{text}</span>
    </blockquote>
  );
}
