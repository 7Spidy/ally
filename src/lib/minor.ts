import { BLOCK_KEY, stateKeyFor } from "@/lib/migrate";
import { getBrowserClient } from "@/lib/supabase/browser";

/**
 * The under-18 block, as the birthday screen runs it (PRD §5.5): remember the
 * block, purge the anonymous user server-side (errors are logged and ignored,
 * the block must hold offline), drop the local session, and remove the
 * per-user local state. Used when an age check mid-chat finds a minor.
 */
export async function purgeMinorAndBlock(uid: string | null, blockedUntil: number): Promise<void> {
  try {
    window.localStorage.setItem(BLOCK_KEY, String(blockedUntil));
  } catch {
    /* storage blocked: the block is best-effort */
  }
  try {
    const supabase = getBrowserClient();
    const { error } = await supabase.rpc("purge_self");
    if (error) console.warn("purge_self failed", error.code);
    await supabase.auth.signOut({ scope: "local" });
  } catch (err) {
    console.warn("purge_self failed", err);
  }
  try {
    if (uid) window.localStorage.removeItem(stateKeyFor(uid));
  } catch {
    /* storage blocked */
  }
}
