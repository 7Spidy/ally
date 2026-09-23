import { createClient } from "@supabase/supabase-js";

/** Service-role client. Server only: this key bypasses RLS. */
export function getAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("admin client must never be constructed in the browser");
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
