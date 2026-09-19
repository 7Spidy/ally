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
import { useManifest } from "@/state/useManifest";
import { active, byId } from "@/lib/selectors";
import { firstNameFromFull } from "@/lib/engine";
import { COPY, fill } from "@/lib/copy";
import { now } from "@/lib/clock";
import { SESSION_KEY, BLOCK_KEY } from "@/lib/migrate";
import styles from "./hubSheets.module.css";

function SwitcherSheet({ currentId }: { currentId?: string }) {
  const router = useRouter();
  const { closeSheet } = useSheet();
  const { state } = useAlly();
  const { templates } = useManifest();
  const activeList = active(state);

  function go(id: string) {
    router.push(`/chat/${id}`);
    closeSheet();
  }

  function goHome() {
    router.push("/home");
    closeSheet();
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
  const { closeSheet } = useSheet();
  const { state, dispatch } = useAlly();
  const { templates } = useManifest();
  const [typed, setTyped] = useState("");

  const companion = byId(state, companionId);
  const template = companion ? templates.find((t) => t.id === companion.templateId) : undefined;
  if (!companion || !template) return null;

  const firstName = firstNameFromFull(template.name);
  const obj = template.gender === "woman" ? "her" : "him";
  const matches = typed.trim().toLowerCase() === firstName.toLowerCase();

  function confirm() {
    dispatch({ type: "PART_COMPANION", companionId, now: now() });
    router.replace("/home");
    closeSheet();
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
        <button type="button" className="btn primary" disabled={!matches} onClick={confirm}>
          {COPY.partSheet.part}
        </button>
      </div>
    </Sheet>
  );
}

function DeleteSheet() {
  const { closeSheet } = useSheet();
  const { dispatch } = useAlly();

  function confirm() {
    dispatch({ type: "DELETE_ALL", now: now() });
    try {
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
        <button type="button" className="btn primary" onClick={confirm}>
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
