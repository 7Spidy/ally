/**
 * Owned by the ledger/plans work area. Export IntroSheet ('intro') and
 * LeaveSheet ('leave') here, then list them in the `ledgerSheets` map below.
 * Do not edit src/components/Sheet.tsx directly: it imports this map.
 *
 * The old UnlockSheet and PaywallSheet are gone: choosing a plan is the
 * /plans screen now, not a sheet.
 */
import type { SheetName } from "@/state/SheetProvider";
import { IntroSheet } from "@/components/IntroSheet";
import { LeaveSheet } from "@/components/LeaveSheet";

export const ledgerSheets: Partial<Record<SheetName, React.ComponentType<Record<string, unknown>>>> = {
  intro: IntroSheet,
  leave: LeaveSheet,
};
