"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { COPY } from "@/lib/copy";
import styles from "./DeckTutorial.module.css";

/** Total choreography length, ms. */
export const TUTORIAL_MS = 5800;
/** The Skip button appears this long after the tutorial starts. */
export const SKIP_AFTER_MS = 1500;

const CHECK_COLOR = "#3FA66B";
const CROSS_COLOR = "#D0463B";
const GLYPH_DRIFT_PX = 90;
const GLYPH_MS = 1600;
const GLYPH_STAGGER_MS = 120;

/** Where the six glyphs of each pass start, as % of the screen, around the swiped card. */
const KEEP_SPOTS: [number, number][] = [
  [58, 42], [70, 34], [80, 46], [64, 58], [76, 62], [86, 54],
];
const PASS_SPOTS: [number, number][] = [
  [42, 36], [30, 44], [20, 34], [36, 58], [24, 62], [14, 50],
];

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    /* unsupported: silent */
  }
}

const t = (ms: number) => ms / TUTORIAL_MS;

/**
 * Card transform keyframes: wiggle, swipe right and back, swipe left and back.
 * Every keyframe lists translateX then rotate so they interpolate as a pair.
 */
function cardKeyframes(): Keyframe[] {
  const at = (x: number, deg: number) => `translateX(${x}%) rotate(${deg}deg)`;
  const frames: Keyframe[] = [{ offset: 0, transform: at(0, 0) }];
  for (let c = 0; c < 3; c++) {
    frames.push({ offset: t(200 * c + 50), transform: at(0, 3) });
    frames.push({ offset: t(200 * c + 150), transform: at(0, -3) });
    frames.push({ offset: t(200 * c + 200), transform: at(0, 0) });
  }
  // An easing on a keyframe shapes the interval that follows it.
  frames[frames.length - 1].easing = "cubic-bezier(.2,.7,.3,1)";
  frames.push({ offset: t(2600), transform: at(38, 8), easing: "ease-in-out" });
  frames.push({ offset: t(3200), transform: at(0, 0), easing: "cubic-bezier(.2,.7,.3,1)" });
  frames.push({ offset: t(5200), transform: at(-38, -8), easing: "ease-in-out" });
  frames.push({ offset: 1, transform: at(0, 0) });
  return frames;
}

/** Backdrop filter keyframes: brighten on the keep, dim and desaturate on the pass. */
function backdropKeyframes(): Keyframe[] {
  const keep = "brightness(1.12) contrast(1.15) saturate(1.2)";
  const pass = "grayscale(0.9) brightness(0.72)";
  return [
    { offset: 0, filter: "none" },
    { offset: t(600), filter: "none" },
    { offset: t(900), filter: keep },
    { offset: t(2600), filter: keep },
    { offset: t(3200), filter: "none" },
    { offset: t(3500), filter: pass },
    { offset: t(5200), filter: pass },
    { offset: 1, filter: "none" },
  ];
}

export interface DeckTutorialProps {
  /** The top card, animated with `transform` only. */
  cardRef: React.RefObject<HTMLElement | null>;
  /** The deck backdrop wrapper (never the card), animated with `filter` only. */
  backdropRef: React.RefObject<HTMLElement | null>;
  reducedMotion: boolean;
  /** Called once when the tutorial finishes or is skipped. */
  onEnd: () => void;
}

/**
 * The first-deck tutorial overlay (spec §4.6). While mounted it covers the
 * deck so nothing underneath takes pointer input. Under reduced motion it is
 * a static two-panel card with a "Got it" button and nothing moves.
 */
export function DeckTutorial({ cardRef, backdropRef, reducedMotion, onEnd }: DeckTutorialProps) {
  const [caption, setCaption] = useState("");
  // Where the caption sits: just under the card. Measured from layout (not
  // the animated bounding box), so the card's own movement never shifts it.
  const [captionTop, setCaptionTop] = useState<number | null>(null);
  const [canSkip, setCanSkip] = useState(false);
  const skipRef = useRef<HTMLButtonElement>(null);
  const keepRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const passRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const ended = useRef(false);
  const animsRef = useRef<Animation[]>([]);

  function finish() {
    if (ended.current) return;
    ended.current = true;
    animsRef.current.forEach((a) => a.cancel());
    animsRef.current = [];
    endRef.current();
  }

  useLayoutEffect(() => {
    const card = cardRef.current;
    const stage = card?.offsetParent as HTMLElement | null;
    if (!card || !stage) return;
    setCaptionTop(stage.offsetTop + card.offsetTop + card.offsetHeight);
  }, [cardRef]);

  useEffect(() => {
    if (reducedMotion) return;
    const card = cardRef.current;
    const backdrop = backdropRef.current;
    ended.current = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const anims: Animation[] = [];

    vibrate([30, 40, 30]);

    if (card) {
      const a = card.animate(cardKeyframes(), { duration: TUTORIAL_MS, fill: "none" });
      a.onfinish = () => finish();
      anims.push(a);
    } else {
      timers.push(setTimeout(finish, TUTORIAL_MS));
    }
    if (backdrop) anims.push(backdrop.animate(backdropKeyframes(), { duration: TUTORIAL_MS, fill: "none" }));

    const glyph = (el: HTMLSpanElement | null, i: number, start: number, dy: number) => {
      if (!el) return;
      anims.push(
        el.animate(
          [
            { opacity: 0, transform: "translateY(0) scale(0.8)" },
            { opacity: 1, offset: 0.25 },
            { opacity: 1, offset: 0.65 },
            { opacity: 0, transform: `translateY(${dy}px) scale(1.05)` },
          ],
          { duration: GLYPH_MS, delay: start + i * GLYPH_STAGGER_MS, fill: "both", easing: "ease-out" }
        )
      );
    };
    keepRefs.current.forEach((el, i) => glyph(el, i, 600, -GLYPH_DRIFT_PX));
    passRefs.current.forEach((el, i) => glyph(el, i, 3200, GLYPH_DRIFT_PX));

    animsRef.current = anims;

    timers.push(setTimeout(() => setCaption(COPY.tutorial.keep), 600));
    timers.push(setTimeout(() => setCaption(""), 2600));
    timers.push(setTimeout(() => setCaption(COPY.tutorial.pass), 3200));
    timers.push(setTimeout(() => setCaption(""), 5200));
    timers.push(setTimeout(() => setCanSkip(true), SKIP_AFTER_MS));

    return () => {
      timers.forEach(clearTimeout);
      anims.forEach((a) => {
        a.onfinish = null;
        a.cancel();
      });
      animsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  // Keyboard users reach Skip as soon as it exists.
  useEffect(() => {
    if (canSkip) skipRef.current?.focus({ preventScroll: true });
  }, [canSkip]);

  if (reducedMotion) {
    return (
      <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={COPY.deck.help}>
        <div className={styles.staticCard}>
          <div className={styles.panels}>
            <div className={styles.panel}>
              <svg className={styles.staticGlyph} viewBox="0 0 24 24" aria-hidden="true" style={{ stroke: CHECK_COLOR }}>
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <p>{COPY.tutorial.keep}</p>
            </div>
            <div className={styles.panel}>
              <svg className={styles.staticGlyph} viewBox="0 0 24 24" aria-hidden="true" style={{ stroke: CROSS_COLOR }}>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              <p>{COPY.tutorial.pass}</p>
            </div>
          </div>
          <button type="button" className="btn primary" onClick={finish} autoFocus>
            {COPY.tutorial.gotIt}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay} aria-label={COPY.deck.help}>
      {KEEP_SPOTS.map(([x, y], i) => (
        <span
          key={`k${i}`}
          ref={(el) => {
            keepRefs.current[i] = el;
          }}
          className={styles.glyph}
          style={{ left: `${x}%`, top: `${y}%` }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" style={{ stroke: CHECK_COLOR, width: 20 + (i % 3) * 4, height: 20 + (i % 3) * 4 }}>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
      ))}
      {PASS_SPOTS.map(([x, y], i) => (
        <span
          key={`p${i}`}
          ref={(el) => {
            passRefs.current[i] = el;
          }}
          className={styles.glyph}
          style={{ left: `${x}%`, top: `${y}%` }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" style={{ stroke: CROSS_COLOR, width: 20 + (i % 3) * 4, height: 20 + (i % 3) * 4 }}>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </span>
      ))}
      <p
        className={styles.caption}
        aria-live="polite"
        // Never lower than the Skip button's row.
        style={captionTop === null ? undefined : { top: `min(${captionTop + 6}px, calc(100% - 84px))`, bottom: "auto" }}
      >
        {caption}
      </p>
      {canSkip && (
        <button ref={skipRef} type="button" className={styles.skip} onClick={finish}>
          {COPY.tutorial.skip}
        </button>
      )}
    </div>
  );
}
