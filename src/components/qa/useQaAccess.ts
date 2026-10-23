"use client";

import { useEffect, useState } from "react";
import { isAdminProfile, isQa } from "@/lib/supabase/queries";

/** Whether this signed-in user may see the QA tools, and whether they are an admin too. The server re-checks every call. */
export function useQaAccess(userId: string | null | undefined): { qa: boolean; admin: boolean } {
  const [access, setAccess] = useState({ qa: false, admin: false });
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void (async () => {
      const [qa, admin] = await Promise.all([isQa().catch(() => false), isAdminProfile(userId).catch(() => false)]);
      if (alive) setAccess({ qa, admin });
    })();
    return () => {
      alive = false;
    };
  }, [userId]);
  return access;
}
