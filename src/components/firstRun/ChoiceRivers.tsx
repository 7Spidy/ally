"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { COPY } from "@/lib/copy";
import { riverOrder, riverRows, tileUrl } from "@/lib/firstRun/order";
import {
  DRAG_SLOP,
  applyDrag,
  decideRelease,
  hintBalance,
  smoothVelocity,
  springStep,
  type Disabled,
  type Side,
} from "@/lib/firstRun/gesture";
import styles from "./ChoiceRivers.module.css";

/**
 * Gender choice, "Option C, Rivers" (first-run visuals spec §4.4), ported
 * from `C_choose` and `verticalChoice` in the prototype. Two marquee rivers
 * of faces (women above, men below) split by a draggable line. Drag down to
 * pull the women river in, up for men, or tap a river.
 *
 * Presentation only: the caller's `onCommit` runs the existing choose(g)
 * body, and `onRoute` fires after the commit animation.
 */

const GAP = 10;
const EAGER_PER_ROW = 4; // the first 8 tiles of each river load eagerly
const HINT_DELAY_MS = 900;
const HINT_S = 1.7;
const HEADER_OUT_S = 0.5;
const DT_MAX = 0.05;

export interface ChoiceRiversProps {
  womanIds: string[];
  manIds: string[];
  disabled: Disabled;
  selected: Side | null;
  isRound2: boolean;
  /** Commit start: the caller's guarded choose(g) body. Returns false to refuse. */
  onCommit: (g: Side) => boolean;
  /** After the commit animation (620 ms, 150 ms under reduced motion). */
  onRoute: (g: Side) => void;
}

export function ChoiceRivers({ womanIds, manIds, disabled, selected, isRound2, onCommit, onRoute }: ChoiceRiversProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const rwRef = useRef<HTMLDivElement>(null);
  const rmRef = useRef<HTMLDivElement>(null);
  const iwRef = useRef<HTMLDivElement>(null);
  const imRef = useRef<HTMLDivElement>(null);
  const dwRef = useRef<HTMLDivElement>(null);
  const dmRef = useRef<HTMLDivElement>(null);
  const lwRef = useRef<HTMLDivElement>(null);
  const lmRef = useRef<HTMLDivElement>(null);
  const lswRef = useRef<HTMLDivElement>(null);
  const lsmRef = useRef<HTMLDivElement>(null);
  const seamRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const zwRef = useRef<HTMLButtonElement>(null);
  const zmRef = useRef<HTMLButtonElement>(null);

  const [rm, setRm] = useState(false);

  const rows = useMemo(
    () => ({ woman: riverRows(riverOrder(womanIds)), man: riverRows(riverOrder(manIds)) }),
    [womanIds, manIds]
  );

  // Everything the frame loop reads lives here, so the loop never re-subscribes.
  const S = useRef({
    b: 0,
    v: 0,
    target: 0,
    committed: false,
    touched: false,
    hintT: null as number | null,
    rm: false,
    disabled,
    topH: 0,
    screenH: 0,
    base: 1,
    lwH: 0,
    headerP: null as number | null,
    lastB: NaN,
    lastTh: NaN,
    dirty: true,
    drag: null as null | { id: number; y: number; b0: number; ly: number; lt: number; vy: number; moved: boolean },
    suppressClick: false,
    routeTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    wake: () => {},
  });
  S.current.disabled = disabled;
  const cb = useRef({ onCommit, onRoute });
  cb.current = { onCommit, onRoute };

  const commitRef = useRef<(g: Side) => void>(() => {});
  commitRef.current = (g: Side) => {
    const s = S.current;
    if (s.committed || s.disabled[g]) return;
    if (!cb.current.onCommit(g)) return;
    s.committed = true;
    s.drag = null;
    s.hintT = null;
    s.target = g === "woman" ? 1 : -1;
    s.headerP = 0;
    if (gripRef.current) gripRef.current.style.opacity = "0";
    try {
      navigator.vibrate?.(8);
    } catch {
      /* unsupported */
    }
    s.routeTimer = setTimeout(() => cb.current.onRoute(g), s.rm ? 150 : 620);
    s.wake();
  };

  // Measure header and screen; re-measured on resize (spec §5.9: never hardcode).
  useLayoutEffect(() => {
    const top = topRef.current;
    const root = rootRef.current;
    const arena = arenaRef.current;
    if (!top || !root || !arena) return;
    const measure = () => {
      const s = S.current;
      s.topH = top.offsetHeight;
      s.screenH = root.clientHeight;
      const A = Math.max(1, s.screenH - s.topH);
      s.base = A / 2;
      const rh = Math.max(0, (s.base - GAP * 3) / 2);
      arena.style.setProperty("--base", `${s.base}px`);
      arena.style.setProperty("--rh", `${rh}px`);
      arena.style.setProperty("--gap", `${GAP}px`);
      if (s.headerP === null) arena.style.top = `${s.topH}px`;
      s.lwH = lwRef.current?.offsetHeight ?? 0;
      s.dirty = true;
      s.wake();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(top);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  // Frame loop: gesture physics and every per-frame style write.
  useEffect(() => {
    const s = S.current;
    s.rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setRm(s.rm);
    let raf = 0;
    let last = 0;
    let alive = true;

    const hintTimer = setTimeout(() => {
      if (!s.touched && !s.rm && !s.committed) {
        s.hintT = 0;
        s.wake();
      }
    }, HINT_DELAY_MS);

    function render() {
      const th = s.headerP === null ? s.topH : s.topH * Math.pow(1 - s.headerP, 3);
      if (!s.dirty && s.b === s.lastB && th === s.lastTh) return;
      s.dirty = false;
      s.lastB = s.b;
      s.lastTh = th;
      const b = s.b;
      const A = Math.max(1, s.screenH - th);
      const sw = (A / 2) * (1 + b);
      const sm = A - sw;
      const bw = Math.max(b, 0);
      const bm = Math.max(-b, 0);
      const px = (n: number) => `${n}px`;
      if (s.headerP !== null && topRef.current && arenaRef.current) {
        topRef.current.style.transform = `translateY(${-(s.topH - th)}px)`;
        topRef.current.style.opacity = String(1 - s.headerP);
        arenaRef.current.style.top = px(th);
      }
      rwRef.current!.style.height = px(sw);
      rmRef.current!.style.height = px(sm);
      iwRef.current!.style.transform = `scale(${Math.max(1, sw / s.base)})`;
      imRef.current!.style.transform = `scale(${Math.max(1, sm / s.base)})`;
      dwRef.current!.style.opacity = String(bm * 0.6);
      dmRef.current!.style.opacity = String(bw * 0.6);
      seamRef.current!.style.transform = `translateY(${sw}px)`;
      seamRef.current!.style.opacity = String(1 - Math.abs(b) * 0.9);
      gripRef.current!.style.transform = `translateY(${sw}px)`;
      lswRef.current!.style.transform = `translateY(${sw - 120}px)`;
      lsmRef.current!.style.transform = `translateY(${sw}px)`;
      lwRef.current!.style.transform = `translateY(${sw - s.lwH - 18}px) scale(${1 + bw * 0.22 - bm * 0.15})`;
      lwRef.current!.style.opacity = String(1 - bm * 0.75);
      lmRef.current!.style.transform = `translateY(${sw + 18}px) scale(${1 + bm * 0.22 - bw * 0.15})`;
      lmRef.current!.style.opacity = String(1 - bw * 0.75);
      zwRef.current!.style.height = px(sw);
      zmRef.current!.style.top = px(sw);
      zmRef.current!.style.height = px(sm);
    }

    function step(dt: number) {
      if (s.headerP !== null && s.headerP < 1) s.headerP = Math.min(1, s.headerP + dt / HEADER_OUT_S);
      if (s.drag) return;
      if (s.hintT !== null) {
        s.hintT += dt;
        const p = s.hintT / HINT_S;
        let t = p < 1 ? hintBalance(p) : 0;
        // Only nudge toward an enabled side (D6).
        if (s.disabled.woman) t = Math.min(t, 0);
        if (s.disabled.man) t = Math.max(t, 0);
        s.target = t;
        if (p >= 1) s.hintT = null;
        s.b += (s.target - s.b) * Math.min(1, dt * 14);
        s.v = 0;
      } else if (s.rm) {
        s.b += (s.target - s.b) * Math.min(1, dt * 12);
      } else {
        [s.b, s.v] = springStep(s.b, s.v, s.target, dt);
      }
      // Settle exactly, so the loop can sleep and the buttons stop moving.
      if (s.hintT === null && Math.abs(s.b - s.target) < 1e-4 && Math.abs(s.v) < 1e-3) {
        s.b = s.target;
        s.v = 0;
      }
    }

    function idle() {
      return (
        !s.drag &&
        s.hintT === null &&
        s.b === s.target &&
        s.v === 0 &&
        (s.headerP === null || s.headerP >= 1) &&
        !s.dirty
      );
    }

    function frame(now: number) {
      raf = 0;
      if (!alive) return;
      const dt = last ? Math.min(DT_MAX, (now - last) / 1000) : 0;
      last = now;
      step(dt);
      render();
      if (idle()) last = 0;
      else raf = requestAnimationFrame(frame);
    }
    s.wake = () => {
      if (alive && !raf) raf = requestAnimationFrame(frame);
    };
    s.dirty = true;
    s.wake();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(hintTimer);
      clearTimeout(s.routeTimer);
      s.wake = () => {};
    };
  }, []);

  // ---- drag: pointer handlers on the arena ----
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const s = S.current;
    if (s.committed || s.drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    s.touched = true;
    s.hintT = null;
    s.suppressClick = false;
    s.drag = { id: e.pointerId, y: e.clientY, b0: s.b, ly: e.clientY, lt: performance.now(), vy: 0, moved: false };
    s.v = 0;
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = S.current;
    const d = s.drag;
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) > DRAG_SLOP) {
      d.moved = true;
      // Capture only once it is a drag, so a plain tap still clicks the button under it.
      try {
        arenaRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
    }
    if (!d.moved) return;
    s.b = applyDrag(d.b0, dy, s.screenH - s.topH, s.disabled);
    const now = performance.now();
    const dt = Math.max(1, now - d.lt);
    d.vy = smoothVelocity(d.vy, (e.clientY - d.ly) / dt);
    d.ly = e.clientY;
    d.lt = now;
    s.wake();
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const s = S.current;
    const d = s.drag;
    if (!d || e.pointerId !== d.id) return;
    s.drag = null;
    if (!d.moved) return; // a tap: the button's onClick handles it
    s.suppressClick = true;
    setTimeout(() => (s.suppressClick = false), 0); // only the click this release may produce
    const g = decideRelease(s.b, d.vy, s.disabled);
    if (g) commitRef.current(g);
    if (!s.committed) {
      s.target = 0;
      s.v = d.vy * 2;
    }
    s.wake();
  }
  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    const s = S.current;
    if (!s.drag || e.pointerId !== s.drag.id) return;
    cancelDrag();
  }
  function cancelDrag() {
    const s = S.current;
    if (!s.drag) return;
    s.drag = null;
    if (!s.committed) {
      s.target = 0;
      s.v = 0;
    }
    s.wake();
  }
  // A drag never also counts as a tap (spec §4.4).
  function onClickCapture(e: React.MouseEvent) {
    const s = S.current;
    if (s.suppressClick && e.detail !== 0) {
      s.suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }

  // Round-two X during a drag opens the leave sheet: drop the drag (spec §5.8).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (arenaRef.current && !arenaRef.current.contains(e.target as Node)) cancelDrag();
    };
    const onBlur = () => cancelDrag();
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const river = (g: Side, list: string[][], dirs: [string, string]) => {
    const empty = list[0].length === 0;
    return (
      <div ref={g === "woman" ? rwRef : rmRef} className={`${styles.river} ${g === "woman" ? styles.w : styles.m} ${empty ? styles.empty : ""}`}>
        <div ref={g === "woman" ? iwRef : imRef} className={styles.rin}>
          {!empty &&
            list.map((row, i) => (
              <div
                key={i}
                className={`${styles.rrow} ${dirs[i] === "rt" ? styles.rt : ""}`}
                style={{ top: `calc(var(--gap) + ${i} * (var(--rh) + var(--gap)))`, ["--dur" as string]: `${[46, 58][i]}s` }}
              >
                <div className={styles.rtrack}>
                  {[...row, ...row].map((id, j) => {
                    const eager = j < EAGER_PER_ROW;
                    return (
                      <div key={j} className={styles.rtile}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- pre-compressed WebP, D5 */}
                        <img
                          alt=""
                          src={tileUrl(id)}
                          loading={eager ? "eager" : "lazy"}
                          decoding={eager ? undefined : "async"}
                          draggable={false}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
        <div ref={g === "woman" ? dwRef : dmRef} className={styles.rdim} />
      </div>
    );
  };

  const label = (g: Side) => (
    <div ref={g === "woman" ? lwRef : lmRef} className={`${styles.glab} ${g === "woman" ? styles.lw : styles.lm}`} aria-hidden="true">
      <span className={styles.glabText}>
        {selected === g && <i className={styles.dot} />}
        {g === "woman" ? COPY.gender.optionWoman : COPY.gender.optionMan}
      </span>
      {disabled[g] && <span className={styles.gsub}>{COPY.round2.genderPoolEmpty}</span>}
    </div>
  );

  const zone = (g: Side) => (
    <button
      ref={g === "woman" ? zwRef : zmRef}
      type="button"
      className={`${styles.zone} ${g === "woman" ? styles.zw : styles.zm}`}
      aria-label={g === "woman" ? COPY.gender.optionWoman : COPY.gender.optionMan}
      aria-pressed={selected === g}
      disabled={disabled[g]}
      onClick={() => commitRef.current(g)}
    />
  );

  return (
    <div ref={rootRef} className={`${styles.root} ${rm ? styles.rm : ""}`}>
      <div ref={topRef} className={styles.top}>
        <h1 className="q">{COPY.gender.question}</h1>
        <p className={styles.hint}>{COPY.gender.hint}</p>
        {isRound2 && <p className={styles.sub}>{COPY.round2.subLine}</p>}
      </div>
      <div
        ref={arenaRef}
        className={styles.arena}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onClickCapture={onClickCapture}
      >
        {river("woman", rows.woman, ["", "rt"])}
        {river("man", rows.man, ["rt", ""])}
        <div ref={lswRef} className={`${styles.labscrim} ${styles.lsw}`} />
        <div ref={lsmRef} className={`${styles.labscrim} ${styles.lsm}`} />
        <div ref={seamRef} className={styles.seam} />
        {label("woman")}
        {label("man")}
        {zone("woman")}
        {zone("man")}
        <div ref={gripRef} className={styles.grip} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7 9.5l5-5 5 5M7 14.5l5 5 5-5" />
          </svg>
        </div>
      </div>
    </div>
  );
}
