import Link from "next/link";
import { getServerClient } from "@/lib/supabase/server";
import { formatWhen, ledgerSummary, userLabel, type AdminListPage } from "@/lib/admin";
import { StatusBadge } from "./StatusBadge";
import styles from "./admin.module.css";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function param(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

function pageHref(q: string, cursor?: { created_at: string; id: string }): string {
  const sp = new URLSearchParams();
  if (q) sp.set("q", q);
  if (cursor) {
    sp.set("after", cursor.created_at);
    sp.set("after_id", cursor.id);
  }
  const s = sp.toString();
  return s ? `/admin?${s}` : "/admin";
}

/** P3 §6.2: every user, newest first, searchable by email, keyset-paginated. */
export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = param(sp.q).trim();
  const after = param(sp.after);
  const afterId = param(sp.after_id);

  const supabase = await getServerClient();
  const { data, error } = await supabase.rpc("admin_list_users", {
    search: q || null,
    cursor_created_at: after || null,
    cursor_id: afterId || null,
    limit_n: PAGE_SIZE,
  });
  const page = data as AdminListPage | null;

  return (
    <>
      <div className={styles.header}>
        <Link href="/home" className="icon-btn" aria-label="Back">
          <svg viewBox="0 0 24 24">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <h1 className={styles.title}>Admin</h1>
      </div>

      <div className={styles.body}>
        <form className={styles.search} method="get" action="/admin" role="search">
          <input className={styles.field} type="search" name="q" defaultValue={q} placeholder="Search by email" aria-label="Search by email" autoComplete="off" />
          <button type="submit" className="btn secondary">
            Search
          </button>
        </form>

        {error || !page ? (
          <p className={styles.empty} role="alert">
            Couldn&apos;t load users. Try again.
          </p>
        ) : page.users.length === 0 ? (
          <p className={styles.empty}>{q ? `No users match “${q}”.` : "No users yet."}</p>
        ) : (
          <ul className={styles.list} aria-label="Users">
            {page.users.map((u) => (
              <li key={u.id}>
                <Link href={`/admin/users/${u.id}`} className={styles.card}>
                  <div className={styles.cardTop}>
                    <span className={styles.email}>{userLabel(u)}</span>
                    <StatusBadge status={u.status} />
                  </div>
                  <p className={styles.meta}>
                    Joined {formatWhen(u.created_at)}
                    <br />
                    Last sign-in {formatWhen(u.last_sign_in_at)}
                    <br />
                    {u.companion_count} {u.companion_count === 1 ? "companion" : "companions"}, {u.message_count}{" "}
                    {u.message_count === 1 ? "message" : "messages"}
                    <br />
                    {ledgerSummary(u.ledger)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {(after || page?.next_cursor) && (
          <nav className={styles.pager} aria-label="Pages">
            {after && (
              <Link href={pageHref(q)} className="btn secondary">
                First page
              </Link>
            )}
            {page?.next_cursor && (
              <Link href={pageHref(q, page.next_cursor)} className="btn secondary">
                Next page
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
