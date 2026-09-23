"use client";

/**
 * Invisible Cloudflare Turnstile. `getToken()` executes the widget and
 * resolves a single-use token; the widget is reset after each use.
 *
 * NEXT_PUBLIC_TURNSTILE_BYPASS=1 skips the script and resolves a dummy
 * token that only passes against Cloudflare's test secret. It exists for
 * the local/E2E stack and MUST NEVER be set on Vercel.
 */

import { useCallback, useEffect, useRef } from "react";

export const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const bypass = () => process.env.NEXT_PUBLIC_TURNSTILE_BYPASS === "1";

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (window.turnstile) return resolve();
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new TypeError("turnstile script failed to load"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function useTurnstile(): { getToken: () => Promise<string>; container: React.RefObject<HTMLDivElement | null> } {
  const container = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const pending = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);

  useEffect(() => {
    return () => {
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* already gone */
        }
      }
      widgetId.current = null;
    };
  }, []);

  const getToken = useCallback(async (): Promise<string> => {
    if (bypass()) return TURNSTILE_DUMMY_TOKEN;
    await loadScript();
    const api = window.turnstile;
    const el = container.current;
    if (!api || !el) throw new TypeError("turnstile unavailable");
    if (!widgetId.current) {
      widgetId.current = api.render(el, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
        size: "invisible",
        execution: "execute",
        callback: (token: string) => {
          pending.current?.resolve(token);
          pending.current = null;
        },
        "error-callback": () => {
          pending.current?.reject(Object.assign(new Error("captcha"), { code: "captcha_failed" }));
          pending.current = null;
        },
      });
    }
    const id = widgetId.current;
    return new Promise<string>((resolve, reject) => {
      pending.current = {
        resolve: (t) => {
          // tokens are single-use
          api.reset(id);
          resolve(t);
        },
        reject,
      };
      api.execute(id);
    });
  }, []);

  return { getToken, container };
}

/** Render once per page that needs a token; pass the ref from useTurnstile. */
export function TurnstileMount({ container }: { container: React.RefObject<HTMLDivElement | null> }) {
  return <div ref={container} aria-hidden="true" />;
}
