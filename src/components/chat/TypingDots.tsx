import styles from "./TypingDots.module.css";

export function TypingDots() {
  return (
    <div className={styles.dots} role="status" aria-label="Typing" data-testid="typing">
      <span />
      <span />
      <span />
    </div>
  );
}
