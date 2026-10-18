import { useRef, useState } from 'react';
import type { PackInfo, PackPreview, TriviaQuestion, View } from '@hot-mic/shared';
import { client } from '../client';

/** The host's pack choices in the lobby: word packs, trivia on or off with its packs, and uploads. */
export function PackSetup({ view, act }: { view: View; act: (p: Promise<string | null>) => void }) {
  const packs = view.packs ?? [];
  const words = packs.filter((p) => p.kind === 'words');
  const trivia = packs.filter((p) => p.kind === 'trivia');
  const c = view.config;
  const toggle = (key: 'packIds' | 'triviaPackIds', id: string) => {
    const now = c[key];
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    if (next.length > 0) act(client.send('setConfig', { [key]: next }));
  };
  const [shown, setShown] = useState<{ title: string; preview: PackPreview } | null>(null);
  const look = async (p: PackInfo) => {
    const r = await client.previewPack({ packId: p.id });
    if (!Array.isArray(r)) setShown({ title: p.name, preview: r });
  };

  return (
    <>
      <fieldset>
        <legend>Word packs</legend>
        {words.map((p) => (
          <PackRow key={p.id} p={p} unit="word" checked={c.packIds.includes(p.id)} onToggle={() => toggle('packIds', p.id)} onLook={() => look(p)} />
        ))}
      </fieldset>

      <label className="radio">
        <input type="checkbox" checked={c.trivia} onChange={() => act(client.send('setConfig', { trivia: !c.trivia }))} />
        Music trivia between rounds
      </label>
      {c.trivia && c.rounds === 1 && <p className="hint">Trivia is asked between rounds, so pick 2 or more rounds.</p>}
      {c.trivia && (
        <fieldset>
          <legend>Trivia packs</legend>
          {trivia.map((p) => (
            <PackRow key={p.id} p={p} unit="question" checked={c.triviaPackIds.includes(p.id)} onToggle={() => toggle('triviaPackIds', p.id)} onLook={() => look(p)} />
          ))}
        </fieldset>
      )}

      <Upload />
      {shown && <PreviewCard title={shown.title} preview={shown.preview} onClose={() => setShown(null)} />}
    </>
  );
}

function PackRow({ p, unit, checked, onToggle, onLook }: { p: PackInfo; unit: string; checked: boolean; onToggle: () => void; onLook: () => void }) {
  return (
    <div className="pack-row">
      <label className="radio">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        {p.name} <span className="muted">({p.count} {unit}{p.count === 1 ? '' : 's'}{p.uploaded ? ' · uploaded' : ''})</span>
      </label>
      <button className="link" onClick={onLook}>Preview</button>
    </div>
  );
}

/** Pick a pack file, see exactly what is wrong with it or what is in it, then add it to the room. */
function Upload() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [result, setResult] = useState<PackPreview | string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    setFile({ name: f.name, text });
    setResult(await client.previewPack({ text }));
  };
  const reset = () => {
    setFile(null);
    setResult(null);
    if (input.current) input.current.value = '';
  };
  const add = async () => {
    if (!file) return;
    setBusy(true);
    const errors = await client.uploadPack(file.text);
    setBusy(false);
    if (errors) setResult(errors);
    else reset();
  };

  return (
    <div className="upload">
      <label className="link">
        Add a pack from a file
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {file && Array.isArray(result) && (
        <div className="pack-errors" role="alert">
          <strong>{file.name} can't be used yet:</strong>
          <ul>{result.map((e) => <li key={e}>{e}</li>)}</ul>
          <button className="link" onClick={reset}>Dismiss</button>
        </div>
      )}
      {file && result && !Array.isArray(result) && (
        <PreviewCard title={file.name} preview={result} onClose={reset} action={<button className="primary" disabled={busy} onClick={() => void add()}>Use this pack</button>} />
      )}
    </div>
  );
}

function PreviewCard({ title, preview, onClose, action }: { title: string; preview: PackPreview; onClose: () => void; action?: React.ReactNode }) {
  return (
    <div className="pack-preview">
      <strong>{preview.name}</strong>
      <span className="muted"> · {title !== preview.name && `${title} · `}{preview.count} {preview.kind === 'words' ? 'word' : 'question'}{preview.count === 1 ? '' : 's'}</span>
      {preview.kind === 'words' ? (
        <p className="sample-words">{preview.words.join(', ')}{preview.count > preview.words.length ? ', …' : ''}</p>
      ) : (
        <ol className="sample-questions">
          {preview.questions.map((q) => <li key={q.question}><Sample q={q} /></li>)}
        </ol>
      )}
      <div className="row">
        {action}
        <button className="link" onClick={onClose}>{action ? 'Cancel' : 'Close'}</button>
      </div>
    </div>
  );
}

function Sample({ q }: { q: TriviaQuestion }) {
  return (
    <>
      {q.question}
      <ul>
        {q.choices.map((c, i) => <li key={c} className={i === q.answer ? 'right' : ''}>{c}{i === q.answer ? ' ✓' : ''}</li>)}
      </ul>
    </>
  );
}
