"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { preload } from "react-dom";
import Link from "next/link";
import { useManifest } from "@/state/useManifest";
import { COPY } from "@/lib/copy";
import { firstNameFromFull } from "@/lib/engine";
import { SPLASH_ORDER, revealUrl } from "@/lib/firstRun/order";
import { A_WELCOME_FRAG, glInit, hexRgb } from "@/lib/firstRun/rippleGl";
import styles from "./RippleSplash.module.css";

/**
 * First-run splash, "Option A, Ripple" (first-run visuals spec §4.3), ported
 * from `A_welcome` in docs/specs/first-run-visuals-prototype.html. One face
 * at a time from all 32 templates; each new face surfaces through a WebGL1
 * water ripple, and a tap on the photo drops a ripple at the finger. Falls
 * back to a crossfade with no WebGL, a lost context, or reduced motion.
 *
 * Never blocks on the manifest (D9): file names derive from SPLASH_ORDER,
 * and only the caption and scrim tint wait for `templates`.
 */

const ORDER: readonly string[] = SPLASH_ORDER;
const N = ORDER.length;
const DWELL = 1.0; // s, D2
const T = 0.95; // s, ripple transition, D2
const FADE_MS = 700; // fallback crossfade
const CAPTION_DELAY_MS = 140;
const CAPTION_SWAP_MS = 180;
const RING_MS = 700;
const DT_MAX = 0.05; // s; a long frame gap (tab hidden) never jumps the timeline

const ease = (p: number) => 1 - Math.pow(1 - p, 2.1);
const zoom = (age: number) => 1 + 0.075 * (1 - Math.pow(Math.min(1, age / (DWELL + T + 1.2)), 0.8));

type Mode = "pending" | "gl" | "fallback";

export function RippleSplash({ onDone }: { onDone: () => void }) {
  const { status, templates } = useManifest();
  const ready = status === "ready";
  const byId = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fbRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>("pending");
  const [rm, setRm] = useState(false);
  const [glReady, setGlReady] = useState(false);
  const [capId, setCapId] = useState<string>(ORDER[0]);
  const [capSwap, setCapSwap] = useState(false);

  // Shared between the GL and fallback paths, so a lost context resumes
  // the fallback on the current face.
  const curRef = useRef(0);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const tapRef = useRef<((c: [number, number]) => void) | null>(null);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
  };

  preload(revealUrl(ORDER[0]), { as: "image", fetchPriority: "high" });
  preload(revealUrl(ORDER[1]), { as: "image" });

  // Palette and caption for face `id`; the caption swaps after a short beat.
  const showFaceRef = useRef<(id: string, captionDelay: number) => void>(() => {});
  showFaceRef.current = (id, captionDelay) => {
    const t = byIdRef.current.get(id);
    if (t && rootRef.current) rootRef.current.style.setProperty("--k", t.palette);
    later(() => {
      setCapSwap(true);
      later(() => {
        setCapId(id);
        setCapSwap(false);
      }, CAPTION_SWAP_MS);
    }, captionDelay);
  };

  // Reduced motion (D7) is read once on mount; it decides the path.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setRm(reduce);
    setMode(reduce ? "fallback" : "gl");
    const timers = timersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  // Once the manifest lands, tint the scrim for the face on screen.
  useEffect(() => {
    if (!ready) return;
    const t = byId.get(ORDER[curRef.current]);
    if (t) rootRef.current?.style.setProperty("--k", t.palette);
  }, [ready, byId]);

  // ---- WebGL path ----
  useEffect(() => {
    if (mode !== "gl") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const G0 = glInit(canvas, A_WELCOME_FRAG);
    if (!G0) {
      setMode("fallback");
      return;
    }
    const G = G0;
    const gl = G.gl;
    let alive = true;
    let raf = 0;
    let last = 0;
    let clock = 0;
    let drawn = false;
    let asp = canvas.clientWidth / Math.max(1, canvas.clientHeight) || 540 / 960;
    const images = new Map<string, HTMLImageElement>();

    const texFor = (i: number) => {
      const id = ORDER[((i % N) + N) % N];
      if (G.has(id)) return G.tex(id);
      if (!images.has(id)) {
        const im = new Image();
        im.decoding = "async";
        im.src = revealUrl(id);
        images.set(id, im);
        (im.decode ? im.decode() : Promise.resolve())
          .then(() => {
            if (alive && images.get(id) === im && !gl.isContextLost()) G.tex(id, im);
          })
          .catch(() => {
            // A failed load is retried the next time this face comes up.
            if (images.get(id) === im) images.delete(id);
          });
      }
      return null;
    };
    const drop = (i: number) => {
      const id = ORDER[((i % N) + N) % N];
      G.drop(id);
      images.delete(id);
    };

    let cur = curRef.current;
    let phase: "dwell" | "trans" = "dwell";
    let t0: number | null = null;
    let center: [number, number] = [0.5, 0.4];
    let maxR = 1.4;
    let queued: [number, number] | null = null;
    const born = new Map<number, number>();

    for (let i = 0; i < 4; i++) texFor(cur + i);

    function start(t: number, c: [number, number]) {
      const nx = (cur + 1) % N;
      if (!texFor(nx)) return false; // never start toward a texture that isn't uploaded
      phase = "trans";
      t0 = t;
      born.set(nx, t);
      center = c;
      maxR =
        Math.max(
          ...[
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ].map(([x, y]) => Math.hypot((x - c[0]) * asp, y - c[1]))
        ) + 0.25;
      const id = ORDER[nx];
      showFaceRef.current(id, CAPTION_DELAY_MS);
      texFor(nx + 1);
      texFor(nx + 2);
      drop(cur - 2);
      const t2 = byIdRef.current.get(id);
      gl.uniform3f(G.u("uTint"), ...(t2 ? hexRgb(t2.palette) : ([1, 1, 1] as [number, number, number])));
      return true;
    }

    tapRef.current = (c) => {
      if (phase === "dwell" && t0 !== null && start(clock, c)) return;
      queued = c;
    };

    function frame(now: number) {
      raf = 0;
      if (!alive) return;
      const dt = last ? Math.min(DT_MAX, (now - last) / 1000) : 0;
      last = now;
      clock += dt;
      const t = clock;
      if (t0 === null) {
        t0 = t;
        born.set(cur, t);
      }
      let p = 0;
      if (phase === "dwell") {
        if (queued && start(t, queued)) queued = null;
        else if (t - t0 >= DWELL) start(t, [0.3 + Math.random() * 0.4, 0.22 + Math.random() * 0.26]);
      }
      if (phase === "trans") {
        p = Math.min(1, (t - t0) / T);
        if (p >= 1) {
          born.delete(cur);
          cur = (cur + 1) % N;
          curRef.current = cur;
          phase = "dwell";
          t0 = t;
          p = 0;
        }
      }
      const ta = texFor(cur);
      if (ta) {
        const nx = (cur + 1) % N;
        const tb = phase === "trans" ? texFor(nx) : ta;
        G.bind(0, "uA", ta);
        G.bind(1, "uB", tb || ta);
        gl.uniform1f(G.u("uP"), phase === "trans" ? ease(p) : 0);
        gl.uniform1f(G.u("uZa"), zoom(t - (born.get(cur) ?? t)));
        gl.uniform1f(G.u("uZb"), zoom(t - (born.get(nx) ?? t)));
        gl.uniform2f(G.u("uC"), center[0], center[1]);
        gl.uniform1f(G.u("uMax"), maxR);
        gl.uniform1f(G.u("uAmp"), 1);
        G.draw();
        if (!drawn) {
          drawn = true;
          setGlReady(true);
        }
      }
      schedule();
    }
    function schedule() {
      if (alive && !raf && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function onVisibility() {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else {
        last = 0; // resume where we left off, no burst
        schedule();
      }
    }
    function onLost(e: Event) {
      e.preventDefault();
      alive = false;
      cancelAnimationFrame(raf);
      setGlReady(false);
      setMode("fallback");
    }

    G.resize();
    const ro = new ResizeObserver(() => {
      if (!alive || gl.isContextLost()) return;
      asp = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      G.resize();
    });
    ro.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("webglcontextlost", onLost);
    schedule();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      tapRef.current = null;
      images.clear();
      G.destroy();
    };
  }, [mode]);

  // ---- Fallback path: two stacked <img> crossfading ----
  useEffect(() => {
    if (mode !== "fallback") return;
    const fb = fbRef.current;
    if (!fb) return;
    const imgs = Array.from(fb.querySelectorAll("img"));
    if (imgs.length < 2) return;
    let alive = true;
    let slot = 0;
    let idx = curRef.current;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dwellMs = (rm ? Math.max(2.4, 2 * DWELL) : DWELL) * 1000 + FADE_MS;

    const show = (el: HTMLImageElement) => {
      el.classList.remove(styles.on);
      void el.offsetWidth; // restart the Ken Burns transition
      el.classList.add(styles.on);
    };
    const prefetch = (i: number) => {
      const im = new Image();
      im.src = revealUrl(ORDER[i % N]);
    };
    imgs[0].src = revealUrl(ORDER[idx]);
    requestAnimationFrame(() => alive && show(imgs[0]));
    prefetch(idx + 1);

    function advance() {
      if (!alive || busy) return;
      busy = true;
      clearTimeout(timer);
      const next = (idx + 1) % N;
      const el = imgs[slot ^ 1];
      el.src = revealUrl(ORDER[next]);
      (el.decode ? el.decode() : Promise.resolve())
        .catch(() => {})
        .then(() => {
          if (!alive) return;
          idx = next;
          curRef.current = idx;
          slot ^= 1;
          show(el);
          imgs[slot ^ 1].classList.remove(styles.on);
          showFaceRef.current(ORDER[idx], 0);
          prefetch(idx + 1);
          busy = false;
          timer = setTimeout(advance, dwellMs);
        });
    }
    timer = setTimeout(advance, dwellMs);
    tapRef.current = () => advance();

    return () => {
      alive = false;
      clearTimeout(timer);
      tapRef.current = null;
    };
  }, [mode, rm]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const root = rootRef.current;
    if (!root || actionsRef.current?.contains(e.target as Node)) return;
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (!rm) {
      const ring = document.createElement("i");
      ring.className = styles.ring;
      ring.style.left = `${x}px`;
      ring.style.top = `${y}px`;
      root.appendChild(ring);
      later(() => ring.remove(), RING_MS);
    }
    tapRef.current?.([x / r.width, y / r.height]);
  }

  const cap = ready ? byId.get(capId) : undefined;

  return (
    <div ref={rootRef} className={styles.screen} onPointerDown={onPointerDown}>
      {/* eslint-disable-next-line @next/next/no-img-element -- pre-compressed WebP, D5 */}
      <img className={styles.poster} src={revealUrl(ORDER[0])} alt="" aria-hidden="true" fetchPriority="high" />
      {mode === "gl" && (
        <canvas ref={canvasRef} className={`${styles.canvas} ${glReady ? styles.drawn : ""}`} aria-hidden="true" />
      )}
      {mode === "fallback" && (
        <div ref={fbRef} className={`${styles.fb} ${rm ? styles.still : ""}`} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" />
        </div>
      )}
      <div className={styles.shade} />
      <div className={styles.wm}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/first-run/mark.png" alt="" width={24} height={30} />
        <span>Ally</span>
      </div>
      <div className={styles.low}>
        <p className={`${styles.cap} ${capSwap ? styles.swap : ""}`} style={cap ? undefined : { visibility: "hidden" }}>
          {cap && (
            <>
              <b>{firstNameFromFull(cap.name)}</b>
              <span>{cap.city.split(",")[0]}</span>
            </>
          )}
        </p>
        <h1 className={styles.hl}>{COPY.splash.headline}</h1>
        <div ref={actionsRef} className={styles.actions}>
          <button className="btn primary" onClick={onDone}>
            {COPY.splash.action}
          </button>
          <Link href="/login" className={styles.loginLink}>
            {COPY.splash.login}
          </Link>
          <p className={styles.footer}>{COPY.splash.footer}</p>
        </div>
      </div>
    </div>
  );
}
