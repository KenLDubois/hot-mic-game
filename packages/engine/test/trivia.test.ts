import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type TriviaQuestion } from '@hot-mic/shared';
import { nextDeadline } from '../src/index.js';
import { room, S, type Sim } from './sim.js';

const WORDS = ['fire', 'night', 'heart', 'rain', 'moon', 'sun'];
const QUESTIONS: TriviaQuestion[] = [
  { question: 'Who sang Thriller?', choices: ['Prince', 'Michael Jackson', 'Madonna'], answer: 1, source: 'https://example.com/a' },
  { question: 'Which band wrote Yellow?', choices: ['Coldplay', 'Muse', 'Keane', 'Travis'], answer: 0 },
];
const IDS = ['ana', 'ben', 'cy', 'di'];

/** Three rounds of two words with trivia, so there are two intermissions and two questions. */
function game(opts: { trivia?: boolean; questions?: TriviaQuestion[] } = {}): Sim {
  const sim = room();
  sim.send({ type: 'setConfig', playerId: 'ana', rounds: 3, wordsPerRound: 2, trivia: opts.trivia ?? true });
  const r = sim.send({ type: 'startGame', playerId: 'ana', words: WORDS, questions: opts.questions ?? QUESTIONS });
  expect(r.filter((e) => e.type === 'error')).toEqual([]);
  return sim;
}
const playRound = (sim: Sim) => sim.advance((DEFAULT_RULES.grabMs + DEFAULT_RULES.doneHoldMs) * 2 + 1);
const answer = (sim: Sim, id: string, choice: number, questionId = sim.state.intermission!.trivia!.id) =>
  sim.send({ type: 'triviaAnswer', playerId: id, questionId, choice });

describe('trivia between rounds', () => {
  it('needs a question for every intermission, but not after the last round', () => {
    const sim = room();
    sim.send({ type: 'setConfig', playerId: 'ana', rounds: 3, wordsPerRound: 2, trivia: true });
    const short = sim.send({ type: 'startGame', playerId: 'ana', words: WORDS, questions: QUESTIONS.slice(0, 1) });
    expect(short[0]).toMatchObject({ type: 'error', code: 'not-enough-questions' });
    expect(sim.state.phase).toBe('lobby');
    const off = room();
    off.send({ type: 'setConfig', playerId: 'ana', rounds: 3, wordsPerRound: 2 });
    expect(off.send({ type: 'startGame', playerId: 'ana', words: WORDS }).filter((e) => e.type === 'error')).toEqual([]);
  });

  it('asks a question first, then the leaderboard, with trivia on', () => {
    const sim = game();
    playRound(sim);
    const v = sim.view('ben').intermission!;
    expect(v.stage).toBe('question');
    expect(v.trivia).toMatchObject({ question: 'Who sang Thriller?', answered: [], eligible: 4, mine: null, correct: null, picks: null });
    expect(v.minUntil).toBeNull();
    expect(nextDeadline(sim.state)).toBeNull(); // no timer: it waits on players
  });

  it('keeps the right answer out of every view until the reveal', () => {
    const sim = game();
    playRound(sim);
    answer(sim, 'ana', 1);
    const json = JSON.stringify(['ana', 'ben', 'cy', 'di'].map((id) => sim.view(id)));
    expect(json).not.toContain('example.com/a');
    expect(sim.view('ben').intermission!.trivia!.correct).toBeNull();
    expect(sim.view('ana').intermission!.trivia).toMatchObject({ mine: 1, answered: ['ana'] });
    expect(sim.view('ben').intermission!.trivia!.mine).toBeNull(); // others' answers are hidden
    expect(sim.view('ben').you.answered).toBe(false);
    expect(sim.view('ana').you.answered).toBe(true);
  });

  it('reveals once everyone connected has answered, and a correct answer scores 1', () => {
    const sim = game();
    playRound(sim);
    answer(sim, 'ana', 1);
    answer(sim, 'ben', 0);
    answer(sim, 'cy', 1);
    expect(sim.state.intermission!.stage).toBe('question');
    answer(sim, 'di', 2);
    const v = sim.view('di').intermission!;
    expect(v.stage).toBe('reveal');
    expect(v.trivia).toMatchObject({ correct: 1, source: 'https://example.com/a' });
    expect(v.trivia!.picks).toHaveLength(4);
    expect(IDS.map((id) => sim.score(id))).toEqual([1, 0, 1, 0]);
  });

  it('locks answers as they are submitted and ignores bad ones', () => {
    const sim = game();
    playRound(sim);
    answer(sim, 'ana', 0);
    answer(sim, 'ana', 1); // too late to change
    answer(sim, 'ben', 7); // not a choice
    answer(sim, 'cy', 1, 'q99'); // not this question
    expect(sim.state.intermission!.trivia!.answers).toEqual({ ana: 0 });
    sim.host('kick', 'di');
    expect(answer(sim, 'di', 1)).toEqual([]);
    expect(sim.state.intermission!.trivia!.answers).toEqual({ ana: 0 });
  });

  it('does not wait for players who are away, but never reveals to an empty room', () => {
    const sim = game();
    playRound(sim);
    sim.send({ type: 'playerDisconnected', playerId: 'di' });
    answer(sim, 'ana', 1);
    answer(sim, 'ben', 1);
    answer(sim, 'cy', 1);
    expect(sim.state.intermission!.stage).toBe('reveal');

    const empty = game();
    playRound(empty);
    for (const id of IDS) empty.send({ type: 'playerDisconnected', playerId: id });
    empty.advance(60 * S);
    expect(empty.state.intermission!.stage).toBe('question');
  });

  it('the host can reveal early, and only the host', () => {
    const sim = game();
    playRound(sim);
    answer(sim, 'ana', 1);
    sim.host('revealTrivia', undefined, 'ben');
    expect(sim.state.intermission!.stage).toBe('question');
    sim.host('revealTrivia');
    expect(sim.state.intermission!.stage).toBe('reveal');
    expect(sim.score('ana')).toBe(1);
    sim.host('revealTrivia'); // nothing more to reveal
    expect(sim.score('ana')).toBe(1);
  });

  it('shows the reveal for 8 s, then the leaderboard with its 20 s minimum counted from there', () => {
    const sim = game();
    playRound(sim);
    sim.host('revealTrivia');
    const start = sim.now;
    sim.advance(DEFAULT_RULES.triviaRevealMs - 5);
    expect(sim.state.intermission!.stage).toBe('reveal');
    sim.advance(10);
    const lb = sim.view('ana').intermission!;
    expect(lb.stage).toBe('leaderboard');
    expect(lb.minUntil).toBe(start + DEFAULT_RULES.triviaRevealMs + DEFAULT_RULES.intermissionMinMs);
  });

  it('ready only counts on the leaderboard, then the next round starts as before', () => {
    const sim = game();
    playRound(sim);
    sim.send({ type: 'ready', playerId: 'ana' });
    expect(sim.state.intermission!.ready).toEqual([]);
    sim.host('revealTrivia');
    sim.advance(DEFAULT_RULES.triviaRevealMs + 1);
    for (const id of IDS) sim.send({ type: 'ready', playerId: id });
    sim.advance(DEFAULT_RULES.intermissionMinMs + S);
    expect(sim.state.phase).toBe('word');
    expect(sim.view('ana').roundNumber).toBe(2);
  });

  it('forceNext moves one step at a time: reveal, leaderboard, next round', () => {
    const sim = game();
    playRound(sim);
    sim.host('forceNext');
    expect(sim.state.intermission!.stage).toBe('reveal');
    sim.host('forceNext');
    expect(sim.state.intermission!.stage).toBe('leaderboard');
    sim.host('forceNext');
    expect(sim.state.phase).toBe('word');
  });

  it('asks the second question in the second intermission, and none after the last round', () => {
    const sim = game();
    playRound(sim);
    sim.host('forceNext'); sim.host('forceNext'); sim.host('forceNext');
    playRound(sim);
    expect(sim.view('ana').intermission!.trivia!.question).toBe('Which band wrote Yellow?');
    sim.host('forceNext'); sim.host('forceNext'); sim.host('forceNext');
    playRound(sim);
    expect(sim.state.phase).toBe('final');
  });

  it('goes straight to the leaderboard with trivia off', () => {
    const sim = game({ trivia: false, questions: [] });
    playRound(sim);
    const v = sim.view('ana').intermission!;
    expect(v.stage).toBe('leaderboard');
    expect(v.trivia).toBeNull();
    expect(v.minUntil).not.toBeNull();
  });
});
