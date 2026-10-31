export const NAME_MIN = 2;
export const NAME_MAX = 24;
export type NameProblem = "empty" | "short" | "long" | "chars" | "shape" | "repeat" | "placeholder";

const PLACEHOLDERS = new Set(["test", "asdf", "qwerty", "admin", "null", "none", "user", "name", "abc", "xyz"]);

export function normaliseName(raw: string): string {
  return raw.normalize("NFC").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

export function checkName(raw: string): { ok: true; value: string } | { ok: false; problem: NameProblem } {
  const v = normaliseName(raw);
  const len = [...v].length;
  if (len === 0) return { ok: false, problem: "empty" };
  if (len < NAME_MIN) return { ok: false, problem: "short" };
  if (len > NAME_MAX) return { ok: false, problem: "long" };
  if (/[^\p{L}\p{M}' -]/u.test(v)) return { ok: false, problem: "chars" };
  if (!/^\p{L}/u.test(v) || !/[\p{L}\p{M}]$/u.test(v) || /[ '-]{2}/.test(v)) return { ok: false, problem: "shape" };
  if (/(.)\1{3,}/iu.test(v)) return { ok: false, problem: "repeat" };
  if (PLACEHOLDERS.has(v.toLowerCase())) return { ok: false, problem: "placeholder" };
  return { ok: true, value: v };
}
