import { useEffect, useRef, useState } from 'react';
import type { PlayerView, View, Vote, WordView } from '@hot-mic/shared';
import { client } from '../client';
import { Countdown, TimerBar, useNow } from '../components';

export function Game({ view }: { view: View }) {
  const players = [...view.players].filter((p) => !p.kicked || p.score > 0);
  const byId = new Map(view.players.map((p) => [p.id, p]));

  return (
    <main className="game">
      <header className="topbar">
        <span>{view.phase === 'final' ? 'Game over' : `Word ${view.wordNumber} of ${view.totalWords}`}</span>
        <span className="muted">Room {view.roomCode}</span>
      </header>

      {view.phase === 'final' ? (
        <Final view={view} />
      ) : (
        view.word && <WordScreen view={view} word={view.word} byId={byId} />
      )}

      <Scoreboard players={players} youId={view.you.playerId} singerId={view.word?.singerId ?? null} final={view.phase === 'final'} />
      {view.you.isHost && view.phase === 'word' && view.word && <HostControls word={view.word} />}
      {view.phase !== 'final' && (
        <button className="link" onClick={() => confirm('Leave this game? You can rejoin with the room code.') && client.leave()}>
          Leave
        </button>
      )}
    </main>
  );
}

function Scoreboard({ players, youId, singerId, final }: { players: PlayerView[]; youId: string; singerId: string | null; final: boolean }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return (
    <ol className={`scoreboard ${final ? 'big' : ''}`}>
      {sorted.map((p) => (
        <li key={p.id} className={`${p.id === youId ? 'you' : ''} ${p.connected ? '' : 'away'} ${p.id === singerId ? 'singer' : ''}`}>
          <span className="name">
            {p.name}
            {p.id === youId && <span className="muted"> (you)</span>}
            {!p.connected && <span className="muted"> · away</span>}
          </span>
          <span className="score">{p.score}</span>
        </li>
      ))}
    </ol>
  );
}

function WordScreen({ view, word, byId }: { view: View; word: WordView; byId: Map<string, PlayerView> }) {
  const me = view.you.playerId;
  const singer = word.singerId ? byId.get(word.singerId) : undefined;
  const iSing = word.singerId === me;
  const name = (id: string) => byId.get(id)?.name ?? 'Someone';

  switch (word.status) {
    case 'open':
      return (
        <section className="stage">
          {word.isSteal && <div className="steal-tag">Steal! The mic is open</div>}
          <div className="word">{word.text}</div>
          <TimerBar deadline={word.deadline} label="Time to grab" />
          <MicButton view={view} word={word} />
          <GrabHint view={view} word={word} />
        </section>
      );

    case 'singing':
    case 'voting':
      return (
        <section className="stage">
          <div className="word small">{word.text}</div>
          {iSing ? (
            <>
              {word.status === 'singing' ? (
                <>
                  <div className="you-have">You have the mic</div>
                  <MicButton view={view} word={word} />
                  <TimerBar deadline={word.capDeadline} label="Song time left" />
                </>
              ) : (
                <>
                  <div className="you-have">Time's up!</div>
                  <p className="hint">Waiting for the votes…</p>
                  <TimerBar deadline={word.deadline} label="Voting time left" />
                </>
              )}
              <VoteCount word={word} />
            </>
          ) : (
            <>
              <div className="singing-now">
                {singer?.name ?? 'Someone'} {word.status === 'singing' ? 'is singing' : 'finished'}
              </div>
              <VoteButtons word={word} mine={view.you.vote} />
              <VoteCount word={word} />
              {word.status === 'voting' && <TimerBar deadline={word.deadline} label="Voting time left" />}
            </>
          )}
        </section>
      );

    case 'result': {
      const r = word.result!;
      const votersFor = (v: Vote) => r.votes.filter((x) => x.vote === v).map((x) => name(x.playerId));
      return (
        <section className="stage">
          <div className="word small">{word.text}</div>
          <div className={`verdict ${r.booed ? 'booed' : 'point'}`}>
            {r.booed ? `${name(word.singerId!)} was booed` : `${name(word.singerId!)} scores +${r.pointsAwarded}`}
          </div>
          <div className="tally">
            <div className="hurray-col">
              <h3>Hurray · {r.hurrays}</h3>
              {votersFor('hurray').map((n) => <div key={n}>{n}</div>)}
            </div>
            <div className="boo-col">
              <h3>Boo · {r.boos}</h3>
              {votersFor('boo').map((n) => <div key={n}>{n}</div>)}
            </div>
          </div>
          {r.votes.length === 0 && <p className="hint">Nobody voted, so the singer keeps the point.</p>}
        </section>
      );
    }

    case 'steal':
      return (
        <section className="stage">
          <div className="word small">{word.text}</div>
          <div className="verdict booed">{name(word.singerId!)} was booed</div>
          <div className="countdown-label">Mic opens in</div>
          <div className="big-count"><Countdown deadline={word.deadline} /></div>
          {iSing || word.lockedOut.includes(me) ? (
            <p className="hint">You're locked out of this word.</p>
          ) : (
            <p className="hint">Get ready to grab it!</p>
          )}
        </section>
      );

    case 'done': {
      const o = word.outcome!;
      return (
        <section className="stage">
          <div className="word small">{word.text}</div>
          <div className="verdict">
            {o.kind === 'scored' && `${name(o.singerId!)} takes ${o.points} points`}
            {o.kind === 'skipped' && 'Nobody grabbed it'}
            {o.kind === 'noPoint' && 'No point this time'}
          </div>
          <p className="hint">Next word coming up…</p>
        </section>
      );
    }
  }
}

function GrabHint({ view, word }: { view: View; word: WordView }) {
  const me = view.you.playerId;
  if (view.you.canGrab) return <p className="hint">Press and hold to grab the mic, and keep holding while you sing.</p>;
  if (word.lockedOut.includes(me)) return <p className="hint">You were booed on this word, so you're locked out.</p>;
  return <p className="hint">You joined mid-word. You can grab from the next one.</p>;
}

/**
 * Press to grab, hold to sing, release to finish. One component for both
 * states so the finger that grabbed is the finger that keeps singing.
 */
function MicButton({ view, word }: { view: View; word: WordView }) {
  const me = view.you.playerId;
  const holding = useRef(false);
  const [grabbing, setGrabbing] = useState(false);
  const iSing = word.status === 'singing' && word.singerId === me;
  const canPress = iSing || (word.status === 'open' && view.you.canGrab);
  const attemptId = word.attemptId;

  // Keep the server's idea of "holding" in step with the finger. This covers a release before
  // the grab was confirmed, and a reconnect while the button is still down.
  useEffect(() => {
    if (!iSing || !attemptId) return;
    if (holding.current && !word.held) void client.send('micPress', { attemptId });
    else if (!holding.current && word.held) void client.send('micRelease', { attemptId });
  }, [iSing, attemptId, word.held, view.version]);

  useEffect(() => {
    if (word.status !== 'open') setGrabbing(false);
  }, [word.status]);

  const down = (e: React.PointerEvent) => {
    if (!canPress || holding.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    holding.current = true;
    if (iSing && attemptId) void client.send('micPress', { attemptId });
    else {
      setGrabbing(true);
      void client.send('grab', { wordId: word.id });
    }
  };
  const up = () => {
    if (!holding.current) return;
    holding.current = false;
    if (iSing && attemptId) void client.send('micRelease', { attemptId });
    // Before the grab is confirmed there is no attempt yet; the effect above releases it.
  };

  const grace = iSing && !word.held ? word.graceDeadline : null;
  const label = iSing ? (word.held ? 'Singing…' : 'Hold to keep going') : grabbing ? 'Grabbing…' : canPress ? 'Hold to grab' : 'Locked';

  return (
    <div className="mic-wrap">
      <button
        className={`mic ${iSing ? 'live' : ''} ${canPress ? '' : 'locked'} ${word.held && iSing ? 'held' : ''}`}
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onContextMenu={(e) => e.preventDefault()}
        disabled={!canPress}
      >
        <span className="mic-icon" aria-hidden>🎤</span>
        <span>{label}</span>
      </button>
      {grace !== null && <GraceRing deadline={grace} />}
    </div>
  );
}

/** The 2-second ring that drains after a release. Pressing again before it empties resumes. */
function GraceRing({ deadline }: { deadline: number }) {
  const now = useNow();
  const frac = Math.max(0, Math.min(1, (deadline - now) / 2000));
  const r = 96;
  const c = 2 * Math.PI * r;
  return (
    <svg className="grace" viewBox="0 0 200 200" aria-hidden>
      <circle cx="100" cy="100" r={r} fill="none" stroke="currentColor" strokeWidth="8" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 100 100)" />
    </svg>
  );
}

function VoteButtons({ word, mine }: { word: WordView; mine: Vote | null }) {
  const vote = (v: Vote) => void client.send('vote', { attemptId: word.attemptId!, vote: v });
  return (
    <div className="votes">
      <button className={`boo ${mine === 'boo' ? 'picked' : ''}`} onClick={() => vote('boo')}>
        👎 Boo
      </button>
      <button className={`hurray ${mine === 'hurray' ? 'picked' : ''}`} onClick={() => vote('hurray')}>
        👏 Hurray
      </button>
    </div>
  );
}

function VoteCount({ word }: { word: WordView }) {
  return (
    <p className="hint">
      {word.voteCount} of {word.eligibleVoters} votes in
    </p>
  );
}

function HostControls({ word }: { word: WordView }) {
  const [open, setOpen] = useState(false);
  const act = (action: 'skipWord' | 'forceNext') => void client.send('hostAction', { action });
  return (
    <section className="host-controls">
      <button className="link" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Host controls'}</button>
      {open && (
        <div className="row">
          <button onClick={() => act('skipWord')} disabled={word.status === 'done'}>Skip word</button>
          <button onClick={() => act('forceNext')} disabled={!['result', 'steal', 'done'].includes(word.status)}>Next</button>
        </div>
      )}
    </section>
  );
}

function Final({ view }: { view: View }) {
  const sorted = [...view.players].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const tied = sorted.filter((p) => p.score === top?.score);
  return (
    <section className="stage">
      <div className="verdict point">
        {tied.length > 1 ? `Tied: ${tied.map((p) => p.name).join(' & ')}` : `${top?.name ?? 'Nobody'} wins!`}
      </div>
      {view.you.isHost ? (
        <button className="primary" onClick={() => void client.send('hostAction', { action: 'newGame' })}>
          Back to lobby
        </button>
      ) : (
        <p className="hint">Waiting for the host to start a new game.</p>
      )}
      <button className="link" onClick={() => client.leave()}>Leave room</button>
    </section>
  );
}
