/**
 * Owned by the hub work area. Export SwitcherSheet ('switcher'), PartSheet
 * ('part') and DeleteSheet ('delete') here, then list them in the
 * `hubSheets` map below. Do not edit src/components/Sheet.tsx directly —
 * it imports this map.
 */
import type { SheetName } from "@/state/SheetProvider";

export const hubSheets: Partial<Record<SheetName, React.ComponentType<Record<string, unknown>>>> = {};
