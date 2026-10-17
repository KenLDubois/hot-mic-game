import { useEffect, useRef, useState } from 'react';
import type { View } from '@hot-mic/shared';
import { client, useAudio } from './client';

/** Level bars driven by the singer's loudness: the local mic for the singer, the media server's report for everyone else. */
export function Waveform({ isSinger, active, className = 'waveform', size = [240, 64] }: { isSinger: boolean; active: boolean; className?: string; size?: [number, number] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const bars = 24;
    const heights = new Array<number>(bars).fill(0);
    let frame = 0;
    let last = 0;
    const draw = (t: number) => {
      frame = requestAnimationFrame(draw);
      if (t - last > 50) {
        last = t;
        heights.shift();
        heights.push(active ? client.audio.level(isSinger) : 0);
      }
      const { width: w, height: h } = el;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = getComputedStyle(el).color;
      const bw = w / bars;
      heights.forEach((v, i) => {
        const bh = Math.max(4, v * h);
        ctx.fillRect(i * bw + 2, (h - bh) / 2, bw - 4, bh);
      });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [isSinger, active]);
  return <canvas ref={canvas} className={className} width={size[0]} height={size[1]} aria-hidden />;
}

/** Asks for the microphone and shows a live level meter, so players can check their mic before the game. */
export function MicCheck() {
  const { mic } = useAudio();
  const [level, setLevel] = useState(0);
  const [running, setRunning] = useState(false);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  async function start() {
    stop.current?.();
    const stream = await client.audio.requestMic();
    if (!stream) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 64));
    };
    tick();
    setRunning(true);
    // Let go of the mic when the lobby closes, so it isn't live outside someone's turn.
    stop.current = () => {
      cancelAnimationFrame(frame);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      stop.current = null;
      setRunning(false);
      setLevel(0);
    };
  }

  // Already allowed on an earlier visit: show the meter without another tap.
  useEffect(() => {
    if (mic === 'granted' && !running && !stop.current) void start();
  }, [mic]);

  return (
    <div className="mic-check" data-mic={mic}>
      {mic === 'granted' && (
        <>
          <div className="meter" role="meter" aria-label="Microphone level" aria-valuenow={Math.round(level * 100)}>
            <div style={{ width: `${level * 100}%` }} />
          </div>
          <p className="hint">Say something. The bar should move. You're good to sing.</p>
        </>
      )}
      {mic === 'unknown' && <button onClick={start}>Allow microphone</button>}
      {mic === 'denied' && (
        <p className="error">
          The microphone is blocked, so you can't grab the mic. You can still vote. To sing, allow the microphone for this site in your browser settings, then <button className="link" onClick={start}>try again</button>.
        </p>
      )}
      {mic === 'unavailable' && (
        <p className="error">No microphone found on this device, so you can't grab the mic. You can still vote.</p>
      )}
    </div>
  );
}

/** Which device in the household plays other houses' singers, and a nudge if the browser is blocking sound. */
export function SpeakerPanel({ view }: { view: View }) {
  const { enabled, playbackBlocked } = useAudio();
  const [error, setError] = useState<string | null>(null);
  if (!enabled) return null;

  const me = view.players.find((p) => p.id === view.you.playerId);
  const here = view.devices.filter((d) => d.householdId === me?.householdId && d.connected);
  const tv = here.find((d) => d.screen);
  const mine = here.filter((d) => !d.screen);
  const nameOf = (id: string | null) => view.players.find((p) => p.id === id)?.name ?? 'Someone';
  const label = (d: (typeof mine)[number]) => {
    const same = mine.filter((x) => x.playerId === d.playerId);
    const n = same.length > 1 ? ` (${same.indexOf(d) + 1})` : '';
    return `${d.id === client.deviceId ? 'This device' : `${nameOf(d.playerId)}'s phone`}${n}`;
  };
  const thisOne = mine.find((d) => d.id === client.deviceId);

  return (
    <div className="speaker-panel">
      <div className="household-name">Sound</div>
      {playbackBlocked && thisOne?.speaker && (
        <button className="primary" onClick={() => void client.audio.enablePlayback()}>
          Tap to turn the sound on
        </button>
      )}
      <p className="hint left">
        {tv
          ? 'Your TV plays the sound, so no phone does.'
          : thisOne?.speaker
          ? "This device plays the singers from other houses. You won't hear your own house through the app."
          : 'Another device in your house plays the sound. Only one does, so nothing echoes.'}
      </p>
      {!tv && mine.length > 1 && (
        <fieldset>
          <legend>Plays the sound</legend>
          {mine.map((d) => (
            <label key={d.id} className="radio">
              <input
                type="radio"
                name="speaker"
                checked={d.speaker}
                onChange={async () => setError(await client.send('setSpeaker', { householdId: d.householdId, deviceId: d.id }))}
              />
              {label(d)}
            </label>
          ))}
        </fieldset>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
