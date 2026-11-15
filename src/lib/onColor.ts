/**
 * The text colour to put on a companion's palette fill: the ink or the fg
 * token, whichever has the higher WCAG contrast against it. Pure.
 *
 * Seven of the 32 palettes are mid-tones where neither token reaches 4.5:1
 * (the fg token tops out near 4.2 to 4.5 on them). For those the choice falls
 * back to pure white or pure black, whichever reads better, so every palette
 * passes. A palette either token already handles keeps the token.
 */
export const MIN_CONTRAST = 4.5;

/** Keep in step with --ink and --fg in app/globals.css. */
export const INK_HEX = "#0a0910";
export const FG_HEX = "#f4efe6";

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** "#rgb" or "#rrggbb" to [r, g, b], 0..255. Anything else reads as black. */
export function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG relative luminance, 0..1. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** The ink or the fg token value: whichever reads better on `hex`; pure black or white when neither reaches MIN_CONTRAST. */
export function onColor(hex: string): string {
  const token = contrast(hex, INK_HEX) >= contrast(hex, FG_HEX) ? INK_HEX : FG_HEX;
  if (contrast(hex, token) >= MIN_CONTRAST) return token;
  return contrast(hex, "#000000") >= contrast(hex, "#ffffff") ? "#000000" : "#ffffff";
}
