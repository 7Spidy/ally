import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerClient } from "@/lib/supabase/server";
import { auditLine, formatWhen, userLabel, type AdminUserDetail } from "@/lib/admin";
import { StatusBadge } from "../../StatusBadge";
import { AccountControls, LedgerControls } from "./AdminControls";
import styles from "../../admin.module.css";

export const dynamic = "force-dynamic";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * P3 §6.2: one user. Everything shown comes from admin_get_user; the
 * controls re-run this page (router.refresh) after each confirmed write
 * rather than guessing the new state. Conversation metadata only, never
 * message text.
 */
export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await getServerClient();
  const { data, error } = await supabase.rpc("admin_get_user", { target: id });
  if (error?.code === "P0002") notFound();
  const user = data as AdminUserDetail | null;

  return (
    <>
      <div className={styles.header}>
        <Link href="/admin" className="icon-btn" aria-label="Back">
          <svg viewBox="0 0 24 24">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <h1 className={styles.title}>{user ? userLabel(user) : "User"}</h1>
      </div>

      <div className={styles.body}>
        {error || !user ? (
          <p className={styles.empty} role="alert">
            Couldn&apos;t load this user. Try again.
          </p>
        ) : (
          <>
            <section className={styles.group} aria-labelledby="identity">
              <h2 id="identity" className={styles.groupLabel}>
                Identity
              </h2>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Status</span>
                <StatusBadge status={user.status} />
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Name</span>
                <span className={styles.rowValue}>{user.display_name || "Not set"}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Account</span>
                <span className={styles.rowValue}>{user.is_anonymous ? "Anonymous" : "Linked"}{user.role === "admin" ? ", admin" : ""}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Joined</span>
                <span className={styles.rowValue}>{formatWhen(user.created_at)}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Last sign-in</span>
                <span className={styles.rowValue}>{formatWhen(user.last_sign_in_at)}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Messages</span>
                <span className={styles.rowValue}>{user.message_count}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>User id</span>
                <span className={styles.rowValue}>{user.id}</span>
              </div>
            </section>

            <LedgerControls user={user} />

            <section className={styles.group} aria-labelledby="companions">
              <h2 id="companions" className={styles.groupLabel}>
                Companions
              </h2>
              {user.companions.length === 0 ? (
                <p className={styles.note}>None yet.</p>
              ) : (
                <ul className={styles.audit}>
                  {user.companions.map((c) => (
                    <li key={c.id}>
                      <div className={styles.controlHead}>
                        <span>
                          {c.template_id} <span className={styles.rowValue}>({c.id})</span>
                        </span>
                        <span className={c.status === "active" ? styles.rowValue : styles.danger}>{c.status === "active" ? "Active" : "Parted"}</span>
                      </div>
                      <p className={styles.meta}>
                        {plural(c.exchanges, "exchange")}, {plural(c.message_count, "message")}. Met {formatWhen(c.created_at)}
                        {c.parted_at ? `, parted ${formatWhen(c.parted_at)}` : ""}.
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <AccountControls user={user} />

            <section className={styles.group} aria-labelledby="audit">
              <h2 id="audit" className={styles.groupLabel}>
                Admin history
              </h2>
              {user.audit.length === 0 ? (
                <p className={styles.note}>No admin actions yet.</p>
              ) : (
                <ul className={styles.audit} aria-label="Admin history">
                  {user.audit.map((a) => (
                    <li key={a.id}>
                      <span>{auditLine(a)}</span>
                      <p className={styles.meta}>
                        {a.actor_email ?? a.actor_id}, {formatWhen(a.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
