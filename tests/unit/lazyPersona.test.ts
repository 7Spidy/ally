import { describe, expect, it } from "vitest";
import { loadPersona } from "@/personas/lazy";
import { LIVE_TEMPLATES, PERSONAS, brainOf, personaFor } from "@/personas/registry";
import * as light from "@/personas/liveTemplates";

describe("lazy persona loader", () => {
  it("loads every one of the 32 personas, identical to the registry", async () => {
    for (const id of Object.keys(PERSONAS)) {
      const p = await loadPersona(id);
      expect(p, id).toEqual(personaFor(id));
    }
  });

  it("reuses one load per face", () => {
    expect(loadPersona("F13")).toBe(loadPersona("F13"));
  });

  it("rejects an unknown or malformed template id", async () => {
    await expect(loadPersona("M99x")).rejects.toThrow(/No persona/);
    await expect(loadPersona("../registry")).rejects.toThrow(/No persona/);
  });

  it("the registry re-exports the light live-template module unchanged", () => {
    expect(LIVE_TEMPLATES).toBe(light.LIVE_TEMPLATES);
    expect(brainOf).toBe(light.brainOf);
  });
});
