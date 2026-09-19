/** Every tunable number in the build. Nothing below is inlined elsewhere. */

export const FREE_DAILY = 100;
export const PASS_HOURS = 24; // rolling from purchase
export const PASS_CAP = 2000; // hidden, never rendered
export const PRICE_SLOT_2 = 199; // INR, placeholder
export const PRICE_SLOT_3 = 349; // INR, placeholder, must exceed PRICE_SLOT_2
export const PRICE_DAY_PASS = 49; // INR, placeholder
export const MAX_COMPANIONS = 3;
export const CHIP_THRESHOLD = 10;
export const PART_PURGE_DAYS = 30;
export const SPLASH_RETURN_MS = 900;
export const LONG_PRESS_MS = 500;

if (PRICE_SLOT_3 <= PRICE_SLOT_2) {
  throw new Error("config guard: PRICE_SLOT_3 must exceed PRICE_SLOT_2");
}
