import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@hot-mic/shared';
import { client } from './client';

export function PlayerChip({ p, you }: { p: PlayerView; you?: boolean }) {
  return (
    <span className={`chip ${p.connected ? '' : 'away'}`}>
      <span className="dot" />
      {p.name}
      {you && <span className="muted"> (you)</span>}
      {p.isHost && <span className="badge">host</span>}
      {!p.connected && !p.kicked && <span className="muted"> · away</span>}
    </span>
  );
}

/** Re-renders about every 100 ms while mounted, for countdowns. */
export function useNow(active = true): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [active]);
  return client.serverNow();
}

/** A shrinking bar toward a server deadline; the last 5 seconds turn red. */
export function TimerBar({ deadline, label }: { deadline: number | null; label?: string }) {
  const now = useNow(deadline !== null);
  const total = useRef({ deadline, ms: 0 });
  if (deadline === null) return null;
  const left = Math.max(0, deadline - now);
  if (total.current.deadline !== deadline) total.current = { deadline, ms: Math.max(left, 1) };
  const frac = Math.min(1, left / total.current.ms);
  return (
    <div className="timer" role="timer" aria-label={label}>
      <div className={`bar ${left <= 5000 ? 'red' : ''}`} style={{ width: `${frac * 100}%` }} />
      <span className="secs">{Math.ceil(left / 1000)}</span>
    </div>
  );
}

export function Countdown({ deadline }: { deadline: number | null }) {
  const now = useNow(deadline !== null);
  if (deadline === null) return null;
  return <>{Math.max(1, Math.ceil((deadline - now) / 1000))}</>;
}
