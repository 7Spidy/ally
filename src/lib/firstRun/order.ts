/**
 * First-run face order (first-run visuals spec §4.2). The first 8 are
 * curated, since most users tap Get started within about eight seconds;
 * the rest alternate women and men for maximum palette contrast.
 */
export const SPLASH_ORDER = [
  "F04","M04","F09","M11","F07","M09","F12","M02","F14","M06","F05","M01","F06","M14","F15","M15",
  "F03","M10","F10","M16","F08","M08","F16","M07","F01","M05","F13","M12","F11","M03","F02","M13",
] as const;

export const MIN_ROW_TILES = 6;

export const revealUrl = (id: string) => `/assets/first-run/reveal/${id}.webp`;
export const tileUrl = (id: string) => `/assets/first-run/tile/${id}.webp`;

/** `SPLASH_ORDER` filtered to `ids`, so the strongest faces lead a river. */
export function riverOrder(ids: readonly string[]): string[] {
  const set = new Set(ids);
  return SPLASH_ORDER.filter((id) => set.has(id));
}

/**
 * Splits a river's ids into two marquee rows by index parity (row 0 takes
 * even indices), then repeats each row until it holds at least
 * MIN_ROW_TILES, so a small pool never shows a gap. A row that parity left
 * empty (a pool of one) borrows the other row's faces.
 */
export function riverRows(ids: readonly string[]): [string[], string[]] {
  if (ids.length === 0) return [[], []];
  const even = ids.filter((_, i) => i % 2 === 0);
  const odd = ids.filter((_, i) => i % 2 === 1);
  const fill = (row: string[]) => {
    const src = row.length ? row : even;
    const out = [...src];
    while (out.length < MIN_ROW_TILES) out.push(...src);
    return out;
  };
  return [fill(even), fill(odd)];
}
