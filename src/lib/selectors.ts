/**
 * Pure selectors over AllyState, listed in spec §4. All take state (and
 * sometimes a templates array) and return derived data; none mutate.
 */

import type { AllyState, Companion, Gender } from "@/state/schema";
import { deckTemplates, firstNameFromFull, type Template } from "@/lib/engine";

export function active(s: AllyState): Companion[] {
  return s.companions.filter((c) => c.status === "active");
}

export function byId(s: AllyState, id: string): Companion | undefined {
  return s.companions.find((c) => c.id === id);
}

export function lastOpened(s: AllyState): Companion | undefined {
  const list = active(s);
  if (!list.length) return undefined;
  return list.reduce((a, b) => (b.lastOpenedAt > a.lastOpenedAt ? b : a));
}

/** Union of active companion templateIds and permanently parted templateIds. */
export function excludedFaces(s: AllyState): Set<string> {
  const set = new Set<string>(s.ledger.parted);
  for (const c of s.companions) {
    if (c.status === "active") set.add(c.templateId);
  }
  return set;
}

export function pool(s: AllyState, templates: Template[], gender: Gender): Template[] {
  return deckTemplates(templates, gender, excludedFaces(s));
}

export function firstName(templateId: string, templates: Template[]): string {
  const t = templates.find((x) => x.id === templateId);
  return t ? firstNameFromFull(t.name) : "";
}
