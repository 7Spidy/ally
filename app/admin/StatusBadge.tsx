import styles from "./admin.module.css";

export function StatusBadge({ status }: { status: "active" | "suspended" | null }) {
  if (status === "suspended") return <span className={`${styles.badge} ${styles.badgeSuspended}`}>Suspended</span>;
  return <span className={`${styles.badge} ${styles.badgeActive}`}>Active</span>;
}
