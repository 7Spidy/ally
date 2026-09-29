/**
 * The Constellation's sound, synthesised with Web Audio (no audio files).
 * Callers create it only when the user's sound is on; with sound off no
 * AudioContext exists at all. Audio never blocks the animation: if the
 * context stays suspended (autoplay policy), every call is a silent no-op.
 */

type Ctx = AudioContext;

export interface HeartbeatSynth {
  /** One "lub-dub". */
  beat(): void;
  /** Rising glissando, then the soft major chord. */
  reveal(): void;
  /** The chord alone (reduced motion). */
  chord(): void;
  /** Close the context after `delayMs` (the page has routed by then). */
  close(delayMs?: number): void;
}

const LUB_HZ = 60;
const DUB_HZ = 50;
const DUB_GAP_S = 0.11;
const ATTACK_S = 0.005;
const DECAY_S = 0.18;
const BEAT_PEAK = 0.5;
const BEAT_LOWPASS_HZ = 180;

const GLISS_FROM_HZ = 440;
const GLISS_TO_HZ = 880;
const GLISS_S = 0.9;
const GLISS_GAIN = 0.06;

const CHORD_HZ = [523.25, 659.25, 783.99]; // C5, E5, G5
const CHORD_GAIN = 0.05;
const CHORD_DECAY_S = 1.2;
const DELAY_S = 0.25;
const DELAY_FEEDBACK = 0.3;

export const CLOSE_AFTER_MS = 1500;

function audioContextCtor(): (new () => Ctx) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: new () => Ctx; webkitAudioContext?: new () => Ctx };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Null when Web Audio is unavailable or the context cannot be created. */
export function createHeartbeat(): HeartbeatSynth | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  let ctx: Ctx;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  ctx.resume?.().catch(() => {});
  let closed = false;

  const live = () => !closed && ctx.state === "running";

  function thump(freq: number, at: number) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    osc.type = "sine";
    osc.frequency.value = freq;
    lp.type = "lowpass";
    lp.frequency.value = BEAT_LOWPASS_HZ;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(BEAT_PEAK, at + ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + ATTACK_S + DECAY_S);
    osc.connect(gain).connect(lp).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + ATTACK_S + DECAY_S + 0.02);
  }

  function playChord(at: number) {
    // A shared feedback delay gives the chord some air.
    const bus = ctx.createGain();
    const delay = ctx.createDelay(1);
    const feedback = ctx.createGain();
    delay.delayTime.value = DELAY_S;
    feedback.gain.value = DELAY_FEEDBACK;
    bus.connect(ctx.destination);
    bus.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(ctx.destination);
    for (const hz of CHORD_HZ) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(CHORD_GAIN, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + CHORD_DECAY_S);
      osc.connect(gain).connect(bus);
      osc.start(at);
      osc.stop(at + CHORD_DECAY_S + 0.02);
    }
  }

  return {
    beat() {
      if (!live()) return;
      const t = ctx.currentTime;
      thump(LUB_HZ, t);
      thump(DUB_HZ, t + DUB_GAP_S);
    },
    reveal() {
      if (!live()) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(GLISS_FROM_HZ, t);
      osc.frequency.exponentialRampToValueAtTime(GLISS_TO_HZ, t + GLISS_S);
      gain.gain.setValueAtTime(GLISS_GAIN, t);
      gain.gain.setValueAtTime(GLISS_GAIN, t + GLISS_S - 0.05);
      gain.gain.linearRampToValueAtTime(0.0001, t + GLISS_S);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + GLISS_S + 0.02);
      playChord(t + GLISS_S);
    },
    chord() {
      if (!live()) return;
      playChord(ctx.currentTime);
    },
    close(delayMs = CLOSE_AFTER_MS) {
      if (closed) return;
      setTimeout(() => {
        closed = true;
        ctx.close().catch(() => {});
      }, delayMs);
    },
  };
}
