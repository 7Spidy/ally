/**
 * Owned by the onboarding work area. Export ConfirmSheet ('confirm') and
 * AccountSheet ('account') here, then list them in the `onboardingSheets`
 * map below. Do not edit src/components/Sheet.tsx directly — it imports
 * this map.
 */
import type { SheetName } from "@/state/SheetProvider";

export const onboardingSheets: Partial<Record<SheetName, React.ComponentType<Record<string, unknown>>>> = {};
