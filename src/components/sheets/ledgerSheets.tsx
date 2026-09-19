/**
 * Owned by the ledger/paywall work area. Export IntroSheet ('intro'),
 * UnlockSheet ('unlock'), LeaveSheet ('leave') and PaywallSheet
 * ('paywall') here, then list them in the `ledgerSheets` map below. Do
 * not edit src/components/Sheet.tsx directly — it imports this map.
 */
import type { SheetName } from "@/state/SheetProvider";
import { IntroSheet } from "@/components/IntroSheet";
import { UnlockSheet } from "@/components/UnlockSheet";
import { LeaveSheet } from "@/components/LeaveSheet";
import { PaywallSheet } from "@/components/PaywallSheet";

export const ledgerSheets: Partial<Record<SheetName, React.ComponentType<Record<string, unknown>>>> = {
  intro: IntroSheet,
  unlock: UnlockSheet as React.ComponentType<Record<string, unknown>>,
  leave: LeaveSheet,
  paywall: PaywallSheet,
};
