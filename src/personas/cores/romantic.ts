/** The Slow-Burn Romantic core. The shared builders live in ./shared; the other brains in ./index. */

import type { Persona } from "@/personas/persona";
import { CORES, coreBlock as coreBlockFor } from "./index";

export * from "./shared";

export const SLOW_BURN_NAME = CORES.ROMANTIC.name;
export const coreBlock = (p: Persona) => coreBlockFor(p, "ROMANTIC");
