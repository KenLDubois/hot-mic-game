import { describe, expect, it } from 'vitest';
import { checkPack, checkThemeFiles, previewPack } from '../src/index.js';

const words = (over: object = {}) => JSON.stringify({ schemaVersion: 1, type: 'words', name: 'Mine', words: [{ text: 'fire' }, { text: 'rain' }], ...over });
const trivia = (questions: unknown[], over: object = {}) =>
  JSON.stringify({ schemaVersion: 1, type: 'trivia', name: 'Quiz', questions, ...over });
const q = (over: object = {}) => ({ question: 'Who?', choices: ['A', 'B', 'C'], answer: 1, ...over });
const errors = (text: string) => {
  const r = checkPack(text);
  if (r.ok) throw new Error('expected the pack to be rejected');
  return r.errors;
};

describe('pack checks name the exact problem', () => {
  it('accepts good word and trivia packs', () => {
    expect(checkPack(words())).toMatchObject({ ok: true, pack: { type: 'words' } });
    expect(checkPack(trivia([q(), q({ source: 'https://en.wikipedia.org/wiki/Thriller_(album)' })]))).toMatchObject({ ok: true, pack: { type: 'trivia' } });
  });

  it('says where the JSON is broken', () => {
    expect(errors('{ "type": ')[0]).toMatch(/^Not valid JSON/);
  });

  it('rejects the wrong type, version or name', () => {
    expect(errors(JSON.stringify({ schemaVersion: 1, name: 'x' }))).toEqual(['"type" must be "words", "trivia" or "theme"']);
    expect(errors(words({ schemaVersion: 2 }))).toEqual(['"schemaVersion" must be 1']);
    expect(errors(words({ name: '' }))).toEqual(['The pack needs a "name" (up to 60 characters)']);
  });

  it('points at the word', () => {
    expect(errors(words({ words: [{ text: 'fire' }, { text: '' }] }))).toEqual(['Word 2 has no text']);
    expect(errors(words({ words: [{ text: 'x'.repeat(41) }] }))[0]).toMatch(/^Word 1 \("x+…"\) is longer than 40 characters$/);
    expect(errors(words({ words: [{ text: 'fire', difficulty: 'tough' }] }))).toEqual(['Word 1 ("fire"): difficulty must be "easy", "medium" or "hard"']);
    expect(errors(words({ words: [] }))).toEqual(['A word pack needs a "words" list with at least one word']);
  });

  it('says which question has no correct answer', () => {
    const questions = Array.from({ length: 12 }, () => q());
    delete (questions[11] as { answer?: number }).answer;
    expect(errors(trivia(questions))).toEqual(['Question 12 has no correct answer (add "answer": the number of the right choice, starting at 0)']);
  });

  it('says when the answer is not one of the choices', () => {
    expect(errors(trivia([q({ answer: 5 })]))).toEqual(['Question 1: answer 5 is not one of its 3 choices (use 0 to 2)']);
    expect(errors(trivia([q({ answer: 'B' })]))[0]).toMatch(/^Question 1: "answer" must be a whole number/);
  });

  it('checks choices, question text and source', () => {
    expect(errors(trivia([q({ choices: ['Only one'], answer: 0 })]))).toEqual(['Question 1 needs 2 to 4 choices, not 1']);
    expect(errors(trivia([q({ choices: ['A', 'B', 'C', 'D', 'E'] })]))).toEqual(['Question 1 needs 2 to 4 choices, not 5']);
    expect(errors(trivia([q({ choices: ['A', 'a', 'C'] })]))).toEqual(['Question 1 has the same choice twice ("a")']);
    expect(errors(trivia([q({ question: ' ' })]))).toEqual(['Question 1 has no question text']);
    expect(errors(trivia([q({ source: 'wikipedia' })]))[0]).toMatch(/^Question 1: source must be a web link/);
  });

  it('reports every problem at once, up to a limit', () => {
    const list = errors(trivia([q({ answer: 9 }), q({ question: '' }), q({ choices: ['x'], answer: 0 })]));
    expect(list).toHaveLength(3);
    expect(errors(trivia(Array.from({ length: 40 }, () => q({ answer: 9 })))).length).toBeLessThanOrEqual(20);
  });

  it('refuses a file that is too big', () => {
    expect(errors(' '.repeat(400_000))[0]).toMatch(/larger than/);
  });

  it('previews a few items, not the whole pack', () => {
    const w = checkPack(words({ words: Array.from({ length: 40 }, (_, i) => ({ text: `w${i}` })) }));
    const t = checkPack(trivia(Array.from({ length: 9 }, () => q())));
    if (!w.ok || !t.ok) throw new Error('bad fixtures');
    expect(previewPack(w.pack)).toMatchObject({ kind: 'words', count: 40, words: expect.any(Array) });
    expect(previewPack(t.pack)).toMatchObject({ kind: 'trivia', count: 9 });
    expect((previewPack(t.pack) as { questions: unknown[] }).questions).toHaveLength(3);
  });
});

describe('theme packs', () => {
  const theme = (over: object = {}) => JSON.stringify({ schemaVersion: 1, type: 'theme', name: 'Spooky', ...over });

  it('accepts a theme with colors, font, background and sounds', () => {
    const r = checkPack(
      theme({
        words: [{ text: 'ghost' }],
        style: { colors: { bg: '#101010', primary: '#ffaa00' }, font: 'display', background: 'bg.svg', sounds: { boo: 'sounds/boo.wav' } },
      }),
    );
    expect(r).toMatchObject({ ok: true, pack: { type: 'theme' } });
    if (!r.ok) return;
    expect(previewPack(r.pack)).toMatchObject({ kind: 'theme', count: 1, font: 'display', background: true, sounds: ['boo'] });
  });

  it('names bad colors, fonts and files', () => {
    expect(errors(theme({ style: { colors: { bg: 'red' } } }))).toEqual(['Color "bg" must look like #1a2b3c']);
    expect(errors(theme({ style: { colors: { sky: '#000000' } } }))[0]).toMatch(/^Unknown color "sky"\. Colors are bg, panel/);
    expect(errors(theme({ style: { font: 'Comic Sans' } }))).toEqual(['"font" must be one of: system, serif, rounded, mono, display, handwriting']);
    expect(errors(theme({ style: { background: '../../etc/passwd' } }))[0]).toMatch(/^"background" must be a file path inside the pack/);
    expect(errors(theme({ style: { sounds: { applause: 'a.wav' } } }))[0]).toMatch(/^Unknown sound "applause"/);
  });

  it('refuses custom CSS and scripts', () => {
    expect(errors(theme({ style: { css: 'body { display: none }' } }))[0]).toMatch(/tokens only.*no custom CSS or code/);
    expect(errors(theme({ script: 'alert(1)' }))[0]).toMatch(/^Unknown field "script"/);
  });

  it('keeps text readable', () => {
    const list = errors(theme({ style: { colors: { bg: '#f4f0ff' } } }));
    expect(list[0]).toMatch(/^The "text" color on "bg" is hard to read/);
    expect(errors(theme({ style: { colors: { primary: '#101010' } } }))[0]).toMatch(/dark button text on "primary"/);
  });

  it('checks a theme against the files that came with it', () => {
    const r = checkPack(theme({ style: { background: 'bg.png', sounds: { boo: 'boo.wav', grab: 'grab.txt', point: 'point.wav' } } }));
    if (!r.ok || r.pack.type !== 'theme') throw new Error('bad fixture');
    const files = new Map([
      ['bg.png', 2_000_000],
      ['grab.txt', 10],
      ['point.wav', 10],
    ]);
    expect(checkThemeFiles(r.pack, files)).toEqual([
      '"background": "bg.png" is larger than 1000 KB',
      'Sound "grab": "grab.txt" must be .wav, .mp3, .ogg',
      'Sound "boo" points to "boo.wav", which is not in the pack',
    ]);
    expect(checkThemeFiles(r.pack, new Map([['bg.png', 5], ['boo.wav', 5], ['grab.wav', 5], ['grab.txt', 5], ['point.wav', 5]]))).toEqual([
      'Sound "grab": "grab.txt" must be .wav, .mp3, .ogg',
    ]);
  });

  it('flags unconfirmed trivia in the preview', () => {
    const t = checkPack(trivia([q(), q({ question: 'Hmm?', unconfirmed: true })]));
    if (!t.ok) throw new Error('bad fixture');
    expect(previewPack(t.pack)).toMatchObject({ kind: 'trivia', unconfirmed: 1 });
  });
});
