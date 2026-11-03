import type { Persona } from "./persona";

const cache = new Map<string, Promise<Persona>>();

/**
 * Client-side persona loader: fetches only the one persona file a chat needs, as its own chunk, instead of
 * bundling all 32 through registry.ts. Server code and tests keep using personaFor() from the registry.
 */
export function loadPersona(templateId: string): Promise<Persona> {
  if (!/^[FM]\d{2}$/.test(templateId)) return Promise.reject(new Error(`No persona for template ${templateId}`));
  let p = cache.get(templateId);
  if (!p) {
    p = import(`./${templateId}.persona.json`).then((m) => (m.default ?? m) as Persona);
    cache.set(templateId, p);
    p.catch(() => cache.delete(templateId));
  }
  return p;
}
