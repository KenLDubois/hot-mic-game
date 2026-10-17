import { useState } from 'react';
import type { RoomInfo } from '@hot-mic/shared';
import { client } from '../client';

const initialCode = () => new URLSearchParams(location.search).get('room')?.toUpperCase().slice(0, 4) ?? '';
const savedName = () => {
  try {
    return localStorage.getItem('hotmic.name') ?? '';
  } catch {
    return '';
  }
};

export function Home({ notice }: { notice: string | null }) {
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(initialCode);
  const [mode, setMode] = useState<'start' | 'create' | 'household'>('start');
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [choice, setChoice] = useState<string>('new'); // household id, or 'new'
  const [household, setHousehold] = useState('');
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);

  const rememberName = () => {
    try {
      localStorage.setItem('hotmic.name', name.trim());
    } catch {
      // not worth failing over
    }
  };

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const err = await fn();
    setBusy(false);
    if (err) setError(err);
    else rememberName();
  }

  async function lookUp() {
    setBusy(true);
    setError(null);
    const r = await client.roomInfo(code);
    setBusy(false);
    if (typeof r === 'string') return setError(r);
    setInfo(r);
    setChoice(r.households[0]?.id ?? 'new');
    setMode('household');
  }

  const nameOk = name.trim().length > 0;

  return (
    <main className="home">
      <h1 className="logo">Hot Mic</h1>
      <p className="tagline">Grab the mic. Sing the word. Face the crowd.</p>

      {error && <p className="error">{error}</p>}

      <label>
        Your name
        <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} autoComplete="nickname" placeholder="Ken" />
      </label>

      {mode === 'start' && (
        <>
          <label>
            Room code
            <input
              className="code-input"
              value={code}
              maxLength={4}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              placeholder="ABCD"
              autoCapitalize="characters"
            />
          </label>
          <button className="primary" disabled={!nameOk || code.length !== 4 || busy} onClick={lookUp}>
            Join room
          </button>
          <div className="or">or</div>
          <button disabled={!nameOk || busy} onClick={() => setMode('create')}>
            Create a room
          </button>
        </>
      )}

      {mode === 'create' && (
        <>
          <label>
            Your household
            <input value={household} maxLength={24} onChange={(e) => setHousehold(e.target.value)} placeholder="Ken's place" />
          </label>
          <p className="hint">Everyone under the same roof joins the same household.</p>
          <button
            className="primary"
            disabled={!nameOk || !household.trim() || busy}
            onClick={() => run(() => client.createRoom(name.trim(), household.trim()))}
          >
            Create room
          </button>
          <button className="link" onClick={() => setMode('start')}>Back</button>
        </>
      )}

      {mode === 'household' && info && (
        <>
          <h2>Room {info.roomCode}</h2>
          <fieldset>
            <legend>Which household are you in?</legend>
            {info.households.map((h) => (
              <label key={h.id} className="radio">
                <input type="radio" name="hh" checked={choice === h.id} onChange={() => setChoice(h.id)} />
                {h.name}
              </label>
            ))}
            <label className="radio">
              <input type="radio" name="hh" checked={choice === 'new'} onChange={() => setChoice('new')} />
              A new household
            </label>
            {choice === 'new' && (
              <input value={household} maxLength={24} onChange={(e) => setHousehold(e.target.value)} placeholder="Household name" />
            )}
          </fieldset>
          <button
            className="primary"
            disabled={!nameOk || busy || (choice === 'new' && !household.trim())}
            onClick={() =>
              run(() =>
                client.join(
                  info.roomCode,
                  name.trim(),
                  choice === 'new' ? { householdName: household.trim() } : { householdId: choice },
                ),
              )
            }
          >
            Join
          </button>
          <button className="link" onClick={() => setMode('start')}>Back</button>
        </>
      )}
    </main>
  );
}
