import { useState } from 'react';
import { LIMITS, type View } from '@hot-mic/shared';
import { client } from '../client';
import { PlayerChip } from '../components';
import { MicCheck, SpeakerPanel } from '../sound';

export function Lobby({ view }: { view: View }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isHost = view.you.isHost;
  const link = `${location.origin}/?room=${view.roomCode}`;

  const visible = view.players.filter((p) => !p.kicked);
  const byHousehold = view.households
    .map((h) => ({ ...h, players: visible.filter((p) => p.householdId === h.id) }))
    .filter((h) => h.players.length > 0);

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: 'Hot Mic', text: `Join my Hot Mic room ${view.roomCode}`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // The share sheet was dismissed.
    }
  }

  const act = async (p: Promise<string | null>) => setError(await p);

  const packs = view.packs ?? [];
  const toggle = (id: string) => {
    const on = view.config.packIds.includes(id);
    const next = on ? view.config.packIds.filter((x) => x !== id) : [...view.config.packIds, id];
    if (next.length > 0) void act(client.send('setConfig', { packIds: next }));
  };

  return (
    <main className="lobby">
      <header>
        <div className="muted">Room code</div>
        <div className="room-code">{view.roomCode}</div>
        <button onClick={share}>{copied ? 'Link copied' : 'Share invite link'}</button>
      </header>

      <section>
        <h2>Players ({visible.length})</h2>
        {byHousehold.map((h) => (
          <div key={h.id} className="household">
            <div className="household-name">{h.name}</div>
            {h.players.map((p) => (
              <div key={p.id} className="row">
                <PlayerChip p={p} you={p.id === view.you.playerId} />
                {isHost && p.id !== view.you.playerId && (
                  <button className="small danger" onClick={() => confirm(`Remove ${p.name}?`) && act(client.send('hostAction', { action: 'kick', playerId: p.id }))}>
                    Kick
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </section>

      <TvHint view={view} />

      <section className="sound">
        <h2>Your microphone</h2>
        <MicCheck />
        <SpeakerPanel view={view} />
      </section>

      {isHost ? (
        <section className="setup">
          <h2>Game setup</h2>
          <div className="stepper">
            <span>Words</span>
            <button
              disabled={view.config.wordsPerRound <= 1}
              onClick={() => act(client.send('setConfig', { wordsPerRound: view.config.wordsPerRound - 1 }))}
            >
              −
            </button>
            <strong>{view.config.wordsPerRound}</strong>
            <button
              disabled={view.config.wordsPerRound >= LIMITS.maxWordsPerRound}
              onClick={() => act(client.send('setConfig', { wordsPerRound: view.config.wordsPerRound + 1 }))}
            >
              +
            </button>
          </div>
          <fieldset>
            <legend>Word packs</legend>
            {packs.map((p) => (
              <label key={p.id} className="radio">
                <input type="checkbox" checked={view.config.packIds.includes(p.id)} onChange={() => toggle(p.id)} />
                {p.name} <span className="muted">({p.wordCount} words)</span>
              </label>
            ))}
          </fieldset>
          {error && <p className="error">{error}</p>}
          {view.startBlocked && <p className="hint">{view.startBlocked}</p>}
          <button className="primary" disabled={!!view.startBlocked} onClick={() => act(client.send('startGame', {}))}>
            Start game
          </button>
        </section>
      ) : (
        <section className="waiting">
          <p>
            Waiting for {view.players.find((p) => p.isHost)?.name ?? 'the host'} to start…
          </p>
          <p className="muted">
            {view.config.wordsPerRound} words · {view.config.packIds.join(', ')}
          </p>
        </section>
      )}
      <button className="link" onClick={() => confirm('Leave this room?') && client.leave()}>
        Leave room
      </button>
    </main>
  );
}

/** How to put the game on a TV: open /screen there. The link carries this household, so the TV joins itself. */
function TvHint({ view }: { view: View }) {
  const [copied, setCopied] = useState(false);
  const me = view.players.find((p) => p.id === view.you.playerId);
  const hasTv = view.devices.some((d) => d.screen && d.connected && d.householdId === me?.householdId);
  const link = `${location.origin}/screen?room=${view.roomCode}&household=${me?.householdId ?? ''}`;
  if (hasTv) return null;
  return (
    <section className="tv-hint-card">
      <h2>Show it on a TV (optional)</h2>
      <p className="hint left">
        Open <strong>{location.host}/screen</strong> in the TV's browser and enter {view.roomCode}. The TV shows the game and plays the sound for your household.
      </p>
      <button
        className="small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard blocked: the address above works too.
          }
        }}
      >
        {copied ? 'TV link copied' : 'Copy a link that skips the typing'}
      </button>
    </section>
  );
}
