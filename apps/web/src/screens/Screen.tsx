import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import type { PlayerView, RoomInfo, TriviaView, View, Vote, WordView } from '@hot-mic/shared';
import { client, useAudio, useClient } from '../client';
import { Countdown, TimerBar } from '../components';
import { playCue } from '../sfx';
import { Waveform } from '../sound';
import { AWARD_TITLES, awardWinners, progressLabel } from '../labels';

/**
 * The TV main screen: join a room, attach to a household, then show whatever the game is doing.
 * It has no game controls; the only things it ever asks for are a room, a household, and one
 * press to turn the sound on (browsers refuse to make sound before that).
 */
export function ScreenApp() {
  const { view, restoring, connected, notice } = useClient();
  useEffect(() => client.onCue(playCue), []);

  return (
    <>
      {!connected && <div className="tv-banner">Reconnecting…</div>}
      {view ? (
        <TvView view={view} />
      ) : restoring ? (
        <div className="tv-center">Connecting…</div>
      ) : (
        <ScreenJoin notice={notice} />
      )}
      <SoundGate />
    </>
  );
}

/** One press on the remote or a click turns sound on; shown only when the browser is still blocking it. */
function SoundGate() {
  const { enabled, playbackBlocked } = useAudio();
  const { view } = useClient();
  const [done, setDone] = useState(false);
  const activated = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
  // Cues are sounds too, so this shows even without the audio server.
  if (!view || (activated && !(enabled && playbackBlocked)) || done) return null;
  return (
    <div className="tv-gate">
      <button
        autoFocus
        onClick={async () => {
          await client.audio.enablePlayback();
          setDone(true);
        }}
      >
        Press OK to turn the sound on
      </button>
    </div>
  );
}

function ScreenJoin({ notice }: { notice: string | null }) {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [code, setCode] = useState((params.get('room') ?? '').toUpperCase().slice(0, 4));
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);

  async function attach(roomCode: string, householdId: string) {
    client.unlockAudio(); // a press on the remote counts as the tap browsers want
    setBusy(true);
    const err = await client.joinScreen(roomCode, householdId);
    setBusy(false);
    if (err) setError(err);
  }

  async function lookUp(roomCode = code) {
    setBusy(true);
    setError(null);
    const r = await client.roomInfo(roomCode);
    setBusy(false);
    if (typeof r === 'string') return setError(r);
    const wanted = params.get('household');
    if (wanted && r.households.some((h) => h.id === wanted)) return void attach(r.roomCode, wanted);
    setInfo(r);
  }

  // A link from a phone carries the room and household, so the TV joins itself.
  useEffect(() => {
    if (code.length === 4 && params.get('room')) void lookUp(code);
  }, []);

  return (
    <main className="tv-join">
      <h1 className="tv-logo">Hot Mic</h1>
      <p className="tv-sub">TV screen</p>
      {error && <p className="tv-error">{error}</p>}

      {!info && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 4) void lookUp();
          }}
        >
          <label>
            Room code
            <input
              autoFocus
              className="tv-code"
              value={code}
              maxLength={4}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              placeholder="ABCD"
              autoCapitalize="characters"
              inputMode="text"
            />
          </label>
          <button type="submit" className="tv-primary" disabled={code.length !== 4 || busy}>
            Continue
          </button>
        </form>
      )}

      {info && (
        <div className="tv-households">
          <h2>Which household is this TV in?</h2>
          {info.households.length === 0 && <p className="tv-sub">Nobody has joined yet. Join on a phone first.</p>}
          {info.households.map((h, i) => (
            <button key={h.id} autoFocus={i === 0} className="tv-primary" disabled={busy} onClick={() => attach(info.roomCode, h.id)}>
              {h.name}
            </button>
          ))}
          <button className="tv-link" onClick={() => setInfo(null)}>
            Change room
          </button>
        </div>
      )}
    </main>
  );
}

function TvView({ view }: { view: View }) {
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const lobby = view.phase === 'lobby';
  return (
    <div className="tv-root">
      <header className="tv-top">
        <span className="tv-brand">Hot Mic</span>
        <span className="tv-top-mid">
          {view.phase !== 'lobby' && progressLabel(view)}
        </span>
        <span className="tv-room">Room {view.roomCode}</span>
      </header>
      <div className={`tv-body ${lobby || view.phase === 'intermission' ? 'lobby' : ''}`}>
        <section className="tv-stage">
          {lobby ? (
            <TvLobby view={view} />
          ) : view.phase === 'final' ? (
            <TvFinal view={view} />
          ) : view.phase === 'intermission' ? (
            <TvIntermission view={view} />
          ) : (
            view.word && <TvWord view={view} word={view.word} byId={byId} />
          )}
        </section>
        {!lobby && view.phase !== 'intermission' && <TvScores view={view} />}
      </div>
    </div>
  );
}

function TvLobby({ view }: { view: View }) {
  const players = view.players.filter((p) => !p.kicked);
  const groups = view.households
    .map((h) => ({ ...h, players: players.filter((p) => p.householdId === h.id) }))
    .filter((h) => h.players.length > 0);
  const link = `${location.origin}/?room=${view.roomCode}`;
  const packs = (view.packs ?? []).filter((p) => view.config.packIds.includes(p.id)).map((p) => p.name);
  const host = view.players.find((p) => p.isHost);

  return (
    <div className="tv-lobby">
      <div className="tv-join-card">
        <Qr text={link} />
        <div className="tv-join-text">
          <div className="tv-label">Join on your phone</div>
          <div className="tv-bigcode">{view.roomCode}</div>
          <div className="tv-url">{location.host}</div>
        </div>
      </div>
      <div className="tv-players">
        {groups.map((h) => (
          <div key={h.id} className="tv-household">
            <div className="tv-household-name">{h.name}</div>
            {h.players.map((p) => (
              <div key={p.id} className={`tv-player ${p.connected ? '' : 'away'}`}>
                <span className="dot" />
                {p.name}
                {p.isHost && <span className="badge">host</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="tv-setup">
        {view.config.wordsPerRound} words{packs.length > 0 && ` · ${packs.join(', ')}`}
        <br />
        Waiting for {host?.name ?? 'the host'} to start…
      </p>
    </div>
  );
}

/** A QR code drawn as SVG squares so it stays sharp at any size. */
function Qr({ text }: { text: string }) {
  const qr = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q;
  }, [text]);
  const n = qr.getModuleCount();
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push(<rect key={`${r}-${c}`} x={c + 2} y={r + 2} width="1" height="1" />);
  return (
    <svg className="tv-qr" viewBox={`0 0 ${n + 4} ${n + 4}`} shapeRendering="crispEdges" role="img" aria-label={`QR code to join room`}>
      <rect width={n + 4} height={n + 4} fill="#fff" />
      <g fill="#14101f">{cells}</g>
    </svg>
  );
}

function TvScores({ view }: { view: View }) {
  const singerId = view.word?.singerId ?? null;
  const sorted = [...view.players].filter((p) => !p.kicked || p.score > 0).sort((a, b) => b.score - a.score);
  return (
    <aside className="tv-scores">
      <h2>Scores</h2>
      <ol>
        {sorted.map((p) => (
          <li key={p.id} className={`${p.connected ? '' : 'away'} ${p.id === singerId && view.word?.status !== 'open' ? 'singer' : ''}`}>
            <span className="name">{p.name}</span>
            <span className="score">{p.score}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function TvWord({ view, word, byId }: { view: View; word: WordView; byId: Map<string, PlayerView> }) {
  const name = (id: string | null) => (id ? byId.get(id)?.name : undefined) ?? 'Someone';
  const singer = name(word.singerId);

  switch (word.status) {
    case 'open':
      return (
        <div className="tv-word-stage">
          {word.isSteal && <div className="tv-steal-tag">Steal! The mic is open</div>}
          <div className="tv-word">{word.text}</div>
          <div className="tv-count">
            <Countdown deadline={word.deadline} />
          </div>
          <TimerBar deadline={word.deadline} label="Time to grab" />
          <p className="tv-hint">
            {word.lockedOut.length > 0 ? `Locked out: ${word.lockedOut.map(name).join(', ')}` : 'Grab the mic on your phone!'}
          </p>
        </div>
      );

    case 'singing':
    case 'voting':
      return (
        <div className="tv-word-stage">
          <div className="tv-word small">{word.text}</div>
          <div className="tv-singer">
            {word.status === 'singing' ? `${singer} has the mic` : `${singer} finished`}
          </div>
          <Waveform isSinger={false} active={word.status === 'singing' && word.held} className="tv-wave" size={[1200, 160]} />
          <p className="tv-votes">
            {word.voteCount} of {word.eligibleVoters} votes in
          </p>
          {word.status === 'singing' ? (
            <TimerBar deadline={word.capDeadline} label="Song time left" />
          ) : (
            <>
              <TimerBar deadline={word.deadline} label="Voting time left" />
              <p className="tv-hint">Vote on your phone</p>
            </>
          )}
        </div>
      );

    case 'result': {
      const r = word.result!;
      const votersFor = (v: Vote) => r.votes.filter((x) => x.vote === v).map((x) => name(x.playerId));
      return (
        <div className="tv-word-stage">
          <div className="tv-word small">{word.text}</div>
          <div className={`tv-verdict ${r.booed ? 'booed' : 'point'}`}>
            {r.booed ? `${singer} was booed` : `${singer} scores +${r.pointsAwarded}`}
          </div>
          <div className="tv-tally">
            <div className="hurray-col">
              <h3>Hurray · {r.hurrays}</h3>
              {votersFor('hurray').map((n, i) => <div key={i}>{n}</div>)}
            </div>
            <div className="boo-col">
              <h3>Boo · {r.boos}</h3>
              {votersFor('boo').map((n, i) => <div key={i}>{n}</div>)}
            </div>
          </div>
          {r.votes.length === 0 && <p className="tv-hint">Nobody voted, so the singer keeps the point.</p>}
        </div>
      );
    }

    case 'steal':
      return (
        <div className="tv-word-stage">
          <div className="tv-word small">{word.text}</div>
          <div className="tv-verdict booed">{singer} was booed</div>
          <div className="tv-label">Mic opens in</div>
          <div className="tv-count huge">
            <Countdown deadline={word.deadline} />
          </div>
        </div>
      );

    case 'done': {
      const o = word.outcome!;
      return (
        <div className="tv-word-stage">
          <div className="tv-word small">{word.text}</div>
          <div className="tv-verdict">
            {o.kind === 'scored' && `${name(o.singerId ?? null)} takes ${o.points} points`}
            {o.kind === 'skipped' && 'Nobody grabbed it'}
            {o.kind === 'noPoint' && 'No point this time'}
          </div>
          <p className="tv-hint">Next word coming up…</p>
        </div>
      );
    }
  }
}

function TvIntermission({ view }: { view: View }) {
  const im = view.intermission!;
  if (im.trivia && im.stage !== 'leaderboard') return <TvTrivia view={view} trivia={im.trivia} revealing={im.stage === 'reveal'} />;
  return <TvLeaderboard view={view} />;
}

function TvTrivia({ view, trivia, revealing }: { view: View; trivia: TriviaView; revealing: boolean }) {
  const players = view.players.filter((p) => !p.kicked);
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? 'Someone';
  const pickedBy = (i: number) => (trivia.picks ?? []).filter((p) => p.choice === i).map((p) => name(p.playerId));
  return (
    <div className="tv-trivia">
      <div className="tv-label">Round {view.roundNumber} trivia</div>
      <div className="tv-question">{trivia.question}</div>
      <div className="tv-choices">
        {trivia.choices.map((c, i) => (
          <div key={i} className={`tv-choice ${revealing ? (i === trivia.correct ? 'correct' : 'dim') : ''}`}>
            <span className="tv-letter">{'ABCD'[i]}</span>
            <span className="tv-choice-text">{c}</span>
            {revealing && pickedBy(i).length > 0 && <span className="tv-picks">{pickedBy(i).join(', ')}</span>}
          </div>
        ))}
      </div>
      {revealing ? (
        <p className="tv-hint">
          {(trivia.picks ?? []).filter((p) => p.choice === trivia.correct).length === 0 ? 'Nobody got it' : 'Correct answers score 1 point'}
        </p>
      ) : (
        <div className="tv-answered">
          {players.map((p) => (
            <span key={p.id} className={`tv-who ${trivia.answered.includes(p.id) ? 'done' : ''} ${p.connected ? '' : 'away'}`}>
              {trivia.answered.includes(p.id) ? '✓ ' : ''}
              {p.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TvLeaderboard({ view }: { view: View }) {
  const im = view.intermission!;
  const sorted = [...view.players].filter((p) => !p.kicked || p.score > 0).sort((a, b) => b.score - a.score);
  const waiting = view.players.filter((p) => !p.kicked && p.connected && !im.ready.includes(p.id));
  return (
    <div className="tv-inter">
      <div className="tv-verdict">Round {view.roundNumber} done</div>
      <table className="tv-leaders">
        <thead>
          <tr>
            <th />
            <th>Score</th>
            <th>Boos cast</th>
            <th>Overruled</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.id} className={p.connected ? '' : 'away'}>
              <td className="name">
                <span className={`tv-tick ${im.ready.includes(p.id) ? 'on' : ''}`}>{im.ready.includes(p.id) ? '✓' : ''}</span>
                {p.name}
              </td>
              <td className="score">{p.score}</td>
              <td>{p.stats.boosCast}</td>
              <td>{p.stats.overruledBoos}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tv-hint">
        {waiting.length > 0 ? `Tap Ready on your phone · waiting for ${waiting.map((p) => p.name).join(', ')}` : 'Everyone is ready'}
        {im.minUntil !== null && im.minUntil > client.serverNow() && (
          <>
            {' · '}next round in at least <Countdown deadline={im.minUntil} /> s
          </>
        )}
      </p>
    </div>
  );
}

function TvFinal({ view }: { view: View }) {
  const sorted = [...view.players].filter((p) => !p.kicked || p.score > 0).sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const tied = sorted.filter((p) => p.score === top?.score);
  return (
    <div className="tv-final">
      <div className="tv-verdict point">{tied.length > 1 ? `Tied: ${tied.map((p) => p.name).join(' & ')}` : `${top?.name ?? 'Nobody'} wins!`}</div>
      <ol className="tv-final-board">
        {sorted.map((p, i) => (
          <li key={p.id}>
            <span className="rank">{i + 1}</span>
            <span className="name">{p.name}</span>
            <span className="score">{p.score}</span>
          </li>
        ))}
      </ol>
      {view.awards.length > 0 && (
        <ul className="tv-awards">
          {view.awards.map((a) => (
            <li key={a.kind}>
              <div className="tv-award-title">{AWARD_TITLES[a.kind].title}</div>
              <div className="tv-award-who">{awardWinners(a, view)}</div>
              <div className="tv-award-why">{AWARD_TITLES[a.kind].why(a.value)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
