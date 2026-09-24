"use client";

/**
 * Owned by the hub work area. Export SwitcherSheet ('switcher'), PartSheet
 * ('part') and DeleteSheet ('delete') here, then list them in the
 * `hubSheets` map below. Do not edit src/components/Sheet.tsx directly —
 * it imports this map.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SheetName } from "@/state/SheetProvider";
import { Sheet } from "@/components/Sheet";
import { useSheet } from "@/state/useSheet";
import { useAlly } from "@/state/useAlly";
import { useToast } from "@/state/useToast";
import { useAuth } from "@/state/useAuth";
import { getBrowserClient } from "@/lib/supabase/browser";
import { partCompanion } from "@/lib/supabase/queries";
import { useManifest } from "@/state/useManifest";
import { active, byId } from "@/lib/selectors";
import { firstNameFromFull } from "@/lib/engine";
import { COPY, fill } from "@/lib/copy";
import { now } from "@/lib/clock";
import { SESSION_KEY, BLOCK_KEY, stateKeyFor } from "@/lib/migrate";
import styles from "./hubSheets.module.css";

function SwitcherSheet({ currentId }: { currentId?: string }) {
  const router = useRouter();
  const { dismissForNavigation } = useSheet();
  const { state } = useAlly();
  const { templates } = useManifest();
  const activeList = active(state);

  // dismissForNavigation()+router.replace(), not closeSheet()+push(): see
  // SheetProvider.tsx's dismissForNavigation doc comment — pairing
  // closeSheet()'s async history.back() with a router navigation (in
  // either order) races and reverts the navigation.
  function go(id: string) {
    dismissForNavigation();
    router.replace(`/chat/${id}`);
  }

  function goHome() {
    dismissForNavigation();
    router.replace("/home");
  }

  return (
    <Sheet labelledBy="switcher-heading">
      <h2 id="switcher-heading" className={styles.heading}>
        {COPY.switcher.heading}
      </h2>
      <div className={styles.list}>
        {activeList.map((c) => {
          const template = templates.find((t) => t.id === c.templateId);
          const name = template ? firstNameFromFull(template.name) : "";
          const isCurrent = c.id === currentId;
          return (
            <button key={c.id} type="button" className={styles.listRow} onClick={() => go(c.id)}>
              <span className={styles.listName}>{name}</span>
              {isCurrent && <span className={styles.tag}>{COPY.switcher.currentTag}</span>}
            </button>
          );
        })}
      </div>
      <button type="button" className={styles.homeRow} onClick={goHome}>
        {COPY.switcher.home}
      </button>
    </Sheet>
  );
}

function PartSheet({ companionId }: { companionId: string }) {
  const router = useRouter();
  const { closeSheet, dismissForNavigation } = useSheet();
  const { state, dispatch } = useAlly();
  const { templates } = useManifest();
  const showToast = useToast();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const companion = byId(state, companionId);
  const template = companion ? templates.find((t) => t.id === companion.templateId) : undefined;
  if (!companion || !template) return null;

  const firstName = firstNameFromFull(template.name);
  const obj = template.gender === "woman" ? "her" : "him";
  const matches = typed.trim().toLowerCase() === firstName.toLowerCase();

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      // P2: part_companion sets the purge date and adds the face to the
      // permanent exclusion list server-side.
      const res = await partCompanion(companionId);
      dispatch({ type: "PART_COMPANION", companionId, partedAt: res.partedAt, purgeAt: res.purgeAt, ledger: res.ledger });
    } catch {
      showToast(COPY.auth.network);
      setBusy(false);
      return;
    }
    // dismissForNavigation(), not closeSheet(): see SheetProvider.tsx's
    // dismissForNavigation doc comment — closeSheet()'s async history.back()
    // races this router.replace() and reverts it regardless of call order.
    dismissForNavigation();
    router.replace("/home");
  }

  return (
    <Sheet labelledBy="part-heading">
      <h2 id="part-heading" className={styles.heading}>
        {fill(COPY.partSheet.heading, { persona: firstName })}
      </h2>
      <p className={styles.body}>{fill(COPY.partSheet.body, { obj })}</p>
      <label className={styles.fieldLabel} htmlFor="part-field">
        {fill(COPY.partSheet.fieldLabel, { persona: firstName })}
      </label>
      <input
        id="part-field"
        className={styles.field}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
      />
      <div className="actions">
        <button type="button" className="btn secondary" onClick={closeSheet}>
          {fill(COPY.partSheet.keep, { persona: firstName })}
        </button>
        <button type="button" className="btn primary" disabled={!matches || busy} onClick={() => void confirm()}>
          {COPY.partSheet.part}
        </button>
      </div>
    </Sheet>
  );
}

function DeleteSheet() {
  const router = useRouter();
  const { closeSheet, dismissForNavigation } = useSheet();
  const { dispatch } = useAlly();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    // A permanent account is never wiped silently: it goes through the
    // fresh-code delete flow in Settings > Account instead.
    if (auth.user && !auth.isAnonymous) {
      dismissForNavigation();
      router.replace("/settings/account");
      return;
    }
    if (busy) return;
    setBusy(true);
    const uid = auth.user?.id ?? null;
    dispatch({ type: "DELETE_ALL", now: now() });
    if (uid) {
      // Anonymous session: purge the server row (its companions, messages and
      // ledger rows cascade with it), drop the session, then the local key.
      try {
        const supabase = getBrowserClient();
        await supabase.rpc("purge_self");
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // offline: the nightly job reaps the anonymous row
      }
    }
    try {
      if (uid) window.localStorage.removeItem(stateKeyFor(uid));
      window.localStorage.removeItem(SESSION_KEY);
      window.localStorage.removeItem(BLOCK_KEY);
    } catch {
      // storage blocked; DELETE_ALL already reset in-memory state
    }
    window.location.href = "/";
  }

  return (
    <Sheet labelledBy="delete-heading">
      <h2 id="delete-heading" className={styles.heading}>
        {COPY.deleteSheet.heading}
      </h2>
      <p className={styles.body}>{COPY.deleteSheet.body}</p>
      <div className="actions">
        <button type="button" className="btn secondary" onClick={closeSheet}>
          {COPY.deleteSheet.keep}
        </button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void confirm()}>
          {COPY.deleteSheet.deleteAll}
        </button>
      </div>
    </Sheet>
  );
}

export const hubSheets: Partial<Record<SheetName, React.ComponentType<Record<string, unknown>>>> = {
  switcher: SwitcherSheet as React.ComponentType<Record<string, unknown>>,
  part: PartSheet as React.ComponentType<Record<string, unknown>>,
  delete: DeleteSheet as React.ComponentType<Record<string, unknown>>,
};
