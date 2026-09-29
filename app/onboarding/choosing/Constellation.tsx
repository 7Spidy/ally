"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import type { Template } from "@/lib/engine";
import { COPY } from "@/lib/copy";
import { createHeartbeat } from "@/lib/sound/heartbeat";
import styles from "./Constellation.module.css";

/** Face size on the ring, px. The hero and the sources are 160. */
const AVATAR = 72;
const HERO = 160;
const FLY_MS = 850;
const FLY_STAGGER_MS = 40;
const ORBIT_S = 12;
const HERO_MS = 600;
const FLOOD_MS = 900;
const FADE_MS = 350;
const RM_FADE_MS = 600;

interface Timeline {
  /** When each heartbeat lands. */
  beats: number[];
  /** When groups of non-winners fade out (after the first and second beat). */
  elim: number[];
  /** Winner leaves the ring and grows to the centre. */
  reveal: number;
  /** The radial flood starts. */
  flood: number;
  /** Route to the proposal. */
  route: number;
}

/** Ring version: gather, three beats, reveal (about 4200 ms). */
export const FULL: Timeline = { beats: [1200, 1780, 2500], elim: [1400, 1980], reveal: 3000, flood: 3300, route: 4200 };
/** One face: no gather, three beats on the centred avatar. */
export const SINGLE: Timeline = { beats: [300, 880, 1600], elim: [], reveal: 2100, flood: 2400, route: 3300 };
/** After "Show me someone else": one beat, then the flood (about 1500 ms). */
export const SHORT: Timeline = { beats: [100], elim: [], reveal: 400, flood: 600, route: 1500 };
/** Reduced motion: the ring cross-fades to the winner, then routes. */
const RM = { fadeAt: 300, route: 1000 };

export interface ConstellationProps {
  winner: Template;
  /** The faces on the ring, winner included. One face (or `short`) skips the ring. */
  ring: Template[];
  short: boolean;
  soundOn: boolean;
  /** Called once, when it is time to route. */
  onDone: () => void;
}

interface Layout {
  w: number;
  h: number;
  rm: boolean;
}

export function Constellation({ winner, ring, short, soundOn, onDone }: ConstellationProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const floodRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const [layout, setLayout] = useState<Layout | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [heroed, setHeroed] = useState(false);

  const single = short || ring.length <= 1;
  const faces = single ? [winner] : ring;
  const timeline = short ? SHORT : single ? SINGLE : FULL;

  // Reduced motion is read once on mount (D12); size is read with it so the
  // first painted frame already has the right layout.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setLayout({ w: el.clientWidth, h: el.clientHeight, rm: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
  }, []);

  useEffect(() => {
    if (!layout) return;
    const { w, h, rm } = layout;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const anims: Animation[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const synth = soundOn ? createHeartbeat() : null; // sound off: no AudioContext at all
    let routed = false;

    function route() {
      if (routed) return;
      routed = true;
      synth?.close();
      doneRef.current();
    }

    // A hidden tab has nobody to watch the animation: skip straight to routing.
    function onVisibility() {
      if (document.visibilityState === "hidden") route();
    }
    document.addEventListener("visibilitychange", onVisibility);

    const winnerNode = () => nodeRefs.current.get(winner.id);

    if (rm) {
      at(RM.fadeAt, () => {
        synth?.chord();
        setHeroed(true);
        ringRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: RM_FADE_MS, fill: "forwards" });
        heroRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: RM_FADE_MS, fill: "forwards" });
      });
      at(RM.route, route);
    } else {
      const beat = () => {
        synth?.beat();
        pulseRef.current?.animate([{ transform: "scale(1)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }], { duration: 420, easing: "ease-out" });
        haloRef.current?.animate(
          [
            { transform: "translate(-50%,-50%) scale(0.2)", opacity: 0.45 },
            { transform: "translate(-50%,-50%) scale(1.6)", opacity: 0 },
          ],
          { duration: 700, easing: "ease-out" }
        );
      };
      timeline.beats.forEach((ms) => at(ms, beat));

      // Non-winners leave in two groups, so only the winner is left at the third beat.
      const losers = faces.filter((f) => f.id !== winner.id).map((f) => f.id);
      const firstGroup = losers.slice(0, Math.ceil(losers.length / 2));
      const secondGroup = losers.slice(firstGroup.length);
      [firstGroup, secondGroup].forEach((group, i) => {
        if (timeline.elim[i] === undefined || !group.length) return;
        at(timeline.elim[i], () => setGone((g) => new Set([...g, ...group])));
      });

      at(timeline.reveal, () => {
        synth?.reveal();
        const root = rootRef.current;
        const hero = heroRef.current;
        if (!root || !hero) return;
        // The hero starts exactly where the winner is on screen right now.
        let dx = 0;
        let dy = 0;
        const node = winnerNode();
        if (node) {
          const a = node.getBoundingClientRect();
          const b = root.getBoundingClientRect();
          dx = a.left + a.width / 2 - (b.left + b.width / 2);
          dy = a.top + a.height / 2 - (b.top + b.height / 2);
        }
        setHeroed(true);
        anims.push(
          hero.animate(
            [
              { transform: `translate(${dx}px, ${dy}px) scale(${AVATAR / HERO})`, opacity: 1 },
              { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
            ],
            { duration: HERO_MS, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }
          )
        );
      });

      at(timeline.flood, () => {
        const flood = floodRef.current;
        if (!flood) return;
        const r = Math.hypot(w / 2, h / 2) + 4;
        anims.push(
          flood.animate([{ clipPath: "circle(0px at 50% 50%)" }, { clipPath: `circle(${r}px at 50% 50%)` }], {
            duration: FLOOD_MS,
            easing: "ease-in-out",
            fill: "forwards",
          })
        );
      });
      at(timeline.route, route);
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.cancel());
      // Leaving early (unmount, refresh) still releases the audio device.
      if (!routed) synth?.close(0);
    };
    // The timeline plays once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  const radius = layout ? 0.32 * Math.min(layout.w, layout.h) : 0;
  const reach = layout ? Math.max(layout.w, layout.h) : 0;

  return (
    <div ref={rootRef} className={`${styles.root} ${layout?.rm ? styles.rm : ""}`} role="status" aria-label={COPY.choosing.label}>
      {layout && (
        <>
          <div ref={floodRef} className={styles.flood} style={{ background: winner.palette }} aria-hidden="true" />
          <div ref={pulseRef} className={styles.pulse} aria-hidden="true">
            <div ref={haloRef} className={styles.halo} style={{ width: radius * 2 + AVATAR, height: radius * 2 + AVATAR }} />
            <div ref={ringRef} className={`${styles.orbit} ${single ? styles.still : ""}`} style={{ ["--orbit" as string]: `${ORBIT_S}s` }}>
              {faces.map((t, i) => {
                const angle = single ? 0 : -Math.PI / 2 + (i * 2 * Math.PI) / faces.length;
                const ex = single ? 0 : Math.cos(angle) * radius;
                const ey = single ? 0 : Math.sin(angle) * radius;
                return (
                  <div
                    key={t.id}
                    ref={(el) => {
                      if (el) nodeRefs.current.set(t.id, el);
                      else nodeRefs.current.delete(t.id);
                    }}
                    className={styles.node}
                    style={{
                      ["--ex" as string]: `${ex}px`,
                      ["--ey" as string]: `${ey}px`,
                      ["--sx" as string]: `${Math.cos(angle) * reach}px`,
                      ["--sy" as string]: `${Math.sin(angle) * reach}px`,
                      animationDuration: `${FLY_MS}ms`,
                      animationDelay: `${i * FLY_STAGGER_MS}ms`,
                    }}
                  >
                    <div
                      className={`${styles.face} ${gone.has(t.id) ? styles.out : ""} ${heroed && t.id === winner.id ? styles.out : ""}`}
                      style={{ background: t.palette, ["--fade" as string]: `${FADE_MS}ms` }}
                    >
                      <Image src={"/" + t.avatar} alt="" width={HERO} height={HERO} className={styles.img} priority />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div ref={heroRef} className={styles.hero} style={{ background: winner.palette, opacity: 0 }} aria-hidden="true">
            <Image src={"/" + winner.avatar} alt="" width={HERO} height={HERO} className={styles.img} priority />
          </div>
        </>
      )}
    </div>
  );
}
