/** Pronoun set for prompt text. Ids starting with M are men (he, him, his); everything else is she, her, her. */
export interface Pronouns {
  sub: string;
  obj: string;
  pos: string;
  Pos: string;
  Sub: string;
}

const SHE: Pronouns = { sub: "she", obj: "her", pos: "her", Pos: "Her", Sub: "She" };
const HE: Pronouns = { sub: "he", obj: "him", pos: "his", Pos: "His", Sub: "He" };

export function pronounsFor(p: { id: string }): Pronouns {
  return p.id.startsWith("M") ? HE : SHE;
}
