"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAlly } from "@/state/useAlly";
import { useManifest } from "@/state/useManifest";
import { ManifestGate } from "@/components/ManifestGate";
import type { Template } from "@/lib/engine";
import { firstNameFromFull, EXPAND_BONUS } from "@/lib/engine";
import { COPY } from "@/lib/copy";
import styles from "./page.module.css";

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}
function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    /* unsupported */
  }
}

const DWELL_FLUSH_MS = 250;

export default function DeckPage() {
  return (
    <ManifestGate>
      <DeckScreen />
    </ManifestGate>
  );
}

function DeckScreen() {
  const router = useRouter();
  const { state, dispatch } = useAlly();
  const { templates } = useManifest();
  const byId = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const flow = state.flow;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drag, setDrag] = useState({ dx: 0, dy: 0, dragging: false });
  const [reducedMotion, setReducedMotion] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dwellAccum = useRef(0);
  const dwellId = useRef<string | null>(null);
  const lastTs = useRef(0);
  const dragStartRef = useRef({ x: 0, y: 0, t: 0, lastX: 0, lastT: 0, vx: 0 });

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  // Redirect if this route was reached without a built deck (e.g. direct nav).
  useEffect(() => {
    if (flow && flow.deckOrder.length === 0) router.replace("/onboarding/matching");
  }, [flow, router]);

  const N = flow?.deckOrder.length ?? 0;
  const index = flow?.deckIndex ?? 0;
  const topId = flow && index < N ? flow.deckOrder[index] : null;
  const under1Id = flow && index + 1 < N ? flow.deckOrder[index + 1] : null;
  const under2Id = flow && index + 2 < N ? flow.deckOrder[index + 2] : null;

  // Preload the first 4 portraits eagerly on mount (spec's Q5-11 preload
  // window doesn't literally reach this route, see report); the rest load
  // lazily as cards come into view via next/image's own lazy loading.
  useEffect(() => {
    if (!flow) return;
    const links: HTMLLinkElement[] = [];
    flow.deckOrder.slice(0, 4).forEach((id) => {
      const t = byId.get(id);
      if (!t) return;
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = "/" + t.portrait;
      document.head.appendChild(link);
      links.push(link);
    });
    return () => links.forEach((l) => l.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow?.deckOrder.join(",")]);

  // Dwell accumulation: while topmost and visible, capped at DWELL_CAP
  // inside the reducer. Flushed to the store every ~250ms via rAF.
  useEffect(() => {
    dwellId.current = topId;
    dwellAccum.current = 0;
    lastTs.current = 0;
    let raf = 0;
    function tick(ts: number) {
      if (document.visibilityState === "visible" && lastTs.current && dwellId.current) {
        const delta = ts - lastTs.current;
        dwellAccum.current += delta;
        if (dwellAccum.current >= DWELL_FLUSH_MS) {
          dispatch({ type: "DECK_DWELL", id: dwellId.current, ms: dwellAccum.current });
          dwellAccum.current = 0;
        }
      }
      lastTs.current = ts;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    function onVisibility() {
      lastTs.current = 0;
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      if (dwellAccum.current > 0 && dwellId.current) {
        dispatch({ type: "DECK_DWELL", id: dwellId.current, ms: dwellAccum.current });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topId]);

  useEffect(() => {
    stageRef.current?.focus({ preventScroll: true });
  }, [topId]);

  const swipe = useCallback(
    (dir: "like" | "pass") => {
      if (!flow || !topId) return;
      if (dir === "like") {
        dispatch({ type: "DECK_LIKE", id: topId });
        vibrate(18);
      }
      dispatch({ type: "DECK_ADVANCE" });
      setExpandedId(null);
      setDrag({ dx: 0, dy: 0, dragging: false });
      // A full single pass through the pool auto-advances to `choosing`;
      // short of that, the `Done` button (visible from the 4th card) lets
      // the user stop early.
      if (flow.deckIndex + 1 >= N) router.push("/onboarding/choosing");
    },
    [flow, topId, dispatch, N, router]
  );

  const expand = useCallback(() => {
    if (!flow || !topId) return;
    setExpandedId(topId);
    if (!flow.expanded.includes(topId)) {
      dispatch({ type: "DECK_EXPAND", id: topId });
      dispatch({ type: "DECK_DWELL", id: topId, ms: EXPAND_BONUS });
    }
  }, [flow, topId, dispatch]);

  const collapse = useCallback(() => setExpandedId(null), []);

  const undo = useCallback(() => {
    if (!flow || flow.deckHistory.length === 0) return;
    dispatch({ type: "DECK_UNDO" });
    setExpandedId(null);
  }, [flow, dispatch]);

  const dragRef = useRef({ dx: 0, dy: 0, dragging: false });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, lastX: e.clientX, lastT: e.timeStamp, vx: 0 };
    dragRef.current = { dx: 0, dy: 0, dragging: true };
    setDrag(dragRef.current);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.dragging) return;
    const s = dragStartRef.current;
    const dt = e.timeStamp - s.lastT;
    if (dt > 0) {
      s.vx = (e.clientX - s.lastX) / dt;
      s.lastX = e.clientX;
      s.lastT = e.timeStamp;
    }
    dragRef.current = { dx: e.clientX - s.x, dy: e.clientY - s.y, dragging: true };
    setDrag(dragRef.current);
  }, []);

  // Side effects (dispatching a swipe/expand) belong in the event handler
  // itself, not inside a setState updater, which React may invoke more
  // than once — read the drag snapshot from a ref instead.
  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    if (!d.dragging) return;
    dragRef.current = { dx: 0, dy: 0, dragging: false };
    setDrag(dragRef.current);
    const el = cardRef.current;
    const w = el?.offsetWidth || 340;
    const h = el?.offsetHeight || 400;
    const vx = dragStartRef.current.vx;
    if (d.dy < -0.32 * h && Math.abs(d.dy) > Math.abs(d.dx)) {
      expand();
    } else if (d.dx > 0.32 * w || vx > 0.4) {
      swipe("like");
    } else if (d.dx < -0.32 * w || vx < -0.4) {
      swipe("pass");
    }
  }, [expand, swipe]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
      if (e.key === "ArrowLeft") swipe("pass");
      else if (e.key === "ArrowRight") swipe("like");
      else if (e.key === "ArrowUp") expand();
      else if (e.key === "ArrowDown" || e.key === "Escape") collapse();
      else if (e.key === "z" || e.key === "Z") undo();
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [swipe, expand, collapse, undo]);

  if (!flow || !topId) return null;

  const topT = byId.get(topId);
  const under1T = under1Id ? byId.get(under1Id) : null;
  const under2T = under2Id ? byId.get(under2Id) : null;
  if (!topT) return null;

  const w = cardRef.current?.offsetWidth || 340;
  const p = clamp(drag.dx / (0.32 * w), -1, 1);
  const rot = reducedMotion ? 0 : clamp((drag.dx / w) * 16, -8, 8);
  const expanded = expandedId === topId;

  return (
    <>
      <div className={styles.counter} aria-live="polite">
        {index + 1} of {N}
      </div>
      <div
        className={styles.stage}
        ref={stageRef}
        tabIndex={0}
        aria-label="Cards. Right arrow likes, left arrow passes, up arrow expands, Z undoes."
      >
        {under2T && <DeckCard t={under2T} className={styles.under2} />}
        {under1T && <DeckCard t={under1T} className={styles.under1} />}
        <DeckCard
          ref={cardRef}
          t={topT}
          top
          expanded={expanded}
          style={{
            transform: drag.dragging ? `translate(${drag.dx}px, ${drag.dy}px) rotate(${rot}deg)` : undefined,
            transition: drag.dragging ? "none" : "transform 200ms cubic-bezier(.3,.6,.4,1)",
            ["--yes" as string]: Math.max(0, p),
            ["--no" as string]: Math.max(0, -p),
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onExpandToggle={() => (expanded ? collapse() : expand())}
        />
      </div>
      <div className={styles.deckbar}>
        <button type="button" className="btn secondary" hidden={flow.deckHistory.length === 0} onClick={undo}>
          Undo
        </button>
        <span className="grow" />
        <button type="button" className="btn primary" hidden={flow.deckHistory.length < Math.min(4, N)} onClick={() => router.push("/onboarding/choosing")}>
          {COPY.deck.done}
        </button>
      </div>
    </>
  );
}

const DeckCard = ({
  t,
  top,
  expanded,
  className,
  style,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onExpandToggle,
  ref,
}: {
  t: Template;
  top?: boolean;
  expanded?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerCancel?: (e: React.PointerEvent) => void;
  onExpandToggle?: () => void;
  ref?: React.Ref<HTMLDivElement>;
}) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      ref={ref}
      className={`${styles.card} ${top ? styles.top : ""} ${expanded ? styles.expanded : ""} ${className ?? ""}`}
      style={{ ["--k" as string]: t.palette, ...style }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className={styles.ph}>
        {!loaded && <div className={styles.placeholder} style={{ background: t.palette }} />}
        <Image
          src={"/" + t.portrait}
          alt=""
          fill
          sizes="390px"
          style={{ objectFit: "cover", opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
          draggable={false}
        />
      </div>
      <div className={styles.info}>
        <p className={styles.pname}>
          {firstNameFromFull(t.name)}, {t.age}
        </p>
        <p className={styles.line}>{t.city}</p>
        <p className={styles.line}>{t.occupation}</p>
        {expanded && (
          <div className={styles.read}>
            <p className={styles.line}>{t.read}</p>
            <button type="button" className={styles.collapse} onClick={(e) => { e.stopPropagation(); onExpandToggle?.(); }}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
