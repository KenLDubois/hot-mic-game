import { describe, expect, it } from 'vitest';
import { checkPack, previewPack } from '../src/index.js';

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
    expect(errors(JSON.stringify({ schemaVersion: 1, name: 'x' }))).toEqual(['"type" must be "words" or "trivia"']);
    expect(errors(JSON.stringify({ type: 'theme' }))).toEqual(['Theme packs are not supported yet']);
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
