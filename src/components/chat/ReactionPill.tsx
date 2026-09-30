import styles from "./ReactionPill.module.css";

/** Instinct-style reaction on the user's bubble, bottom-left, scaling in. */
export function ReactionPill({ emoji }: { emoji: string }) {
  return (
    <span className={styles.pill} data-testid="reaction" aria-label={`Reaction ${emoji}`}>
      {emoji}
    </span>
  );
}
