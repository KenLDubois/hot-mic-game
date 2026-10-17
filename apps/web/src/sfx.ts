import type { CueName } from '@hot-mic/shared';
import { client } from './client';

type Note = { at: number; freq: number; dur: number; type?: OscillatorType; gain?: number; slideTo?: number };

/** Short synthesized sounds for the TV, so the app ships no audio files. */
const CUES: Record<CueName, Note[]> = {
  grab: [
    { at: 0, freq: 880, dur: 0.08, type: 'square', gain: 0.18 },
    { at: 0.08, freq: 1320, dur: 0.14, type: 'square', gain: 0.18 },
  ],
  point: [
    { at: 0, freq: 523, dur: 0.14, type: 'triangle' },
    { at: 0.12, freq: 659, dur: 0.14, type: 'triangle' },
    { at: 0.24, freq: 784, dur: 0.14, type: 'triangle' },
    { at: 0.36, freq: 1047, dur: 0.4, type: 'triangle' },
  ],
  boo: [
    { at: 0, freq: 220, dur: 0.5, type: 'sawtooth', gain: 0.22, slideTo: 90 },
    { at: 0.05, freq: 165, dur: 0.5, type: 'sawtooth', gain: 0.16, slideTo: 70 },
  ],
  steal: [
    { at: 0, freq: 600, dur: 0.18, type: 'square', gain: 0.14, slideTo: 900 },
    { at: 0.2, freq: 600, dur: 0.18, type: 'square', gain: 0.14, slideTo: 900 },
  ],
  round: [
    { at: 0, freq: 660, dur: 0.16, type: 'triangle' },
    { at: 0.16, freq: 880, dur: 0.3, type: 'triangle' },
  ],
  final: [
    { at: 0, freq: 523, dur: 0.18, type: 'triangle' },
    { at: 0.18, freq: 659, dur: 0.18, type: 'triangle' },
    { at: 0.36, freq: 784, dur: 0.18, type: 'triangle' },
    { at: 0.54, freq: 1047, dur: 0.6, type: 'triangle' },
  ],
};

/** Plays a cue if the browser lets this page make sound yet; silent otherwise. */
export function playCue(name: CueName) {
  const ctx = client.audio.runningContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  for (const n of CUES[name]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = n.type ?? 'sine';
    osc.frequency.setValueAtTime(n.freq, t0 + n.at);
    if (n.slideTo) osc.frequency.linearRampToValueAtTime(n.slideTo, t0 + n.at + n.dur);
    const peak = n.gain ?? 0.2;
    gain.gain.setValueAtTime(0.0001, t0 + n.at);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.dur + 0.05);
  }
}
