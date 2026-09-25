import { redirect } from "next/navigation";
import { getServerClient } from "@/lib/supabase/server";
import styles from "./admin.module.css";

// Per-request: the role check reads the caller's session cookies.
export const dynamic = "force-dynamic";

/**
 * P3 §6.1: second line of the admin route guard, after middleware.ts.
 * Non-admins never get as far as rendering a page; the admin_* RPCs' own
 * is_admin() check is what actually protects the data.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") redirect("/home");
  return <div className={styles.page}>{children}</div>;
}
