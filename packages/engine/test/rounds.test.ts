import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '@hot-mic/shared';
import { awards, nextDeadline } from '../src/index.js';
import { room, S, type Sim } from './sim.js';

const WORDS = ['fire', 'night', 'heart', 'rain', 'moon', 'sun'];
const MIN = DEFAULT_RULES.intermissionMinMs;

/** Four players, `rounds` rounds of two words each. */
function game(rounds = 2): Sim {
  const sim = room();
  sim.send({ type: 'setConfig', playerId: 'ana', rounds, wordsPerRound: 2 });
  sim.send({ type: 'startGame', playerId: 'ana', words: WORDS });
  return sim;
}

/** Nobody grabs: both words of the round time out and the round ends. */
function playRound(sim: Sim) {
  sim.advance((DEFAULT_RULES.grabMs + DEFAULT_RULES.doneHoldMs) * 2 + 1);
}

describe('rounds and intermissions', () => {
  it('the host sets rounds, within limits, only in the lobby', () => {
    const sim = room();
    const bad = sim.send({ type: 'setConfig', playerId: 'ana', rounds: 0 });
    expect(bad[0]).toMatchObject({ type: 'error', code: 'bad-config' });
    expect(sim.send({ type: 'setConfig', playerId: 'ben', rounds: 3 })[0]).toMatchObject({ code: 'not-host' });
    sim.send({ type: 'setConfig', playerId: 'ana', rounds: 3, wordsPerRound: 2 });
    expect(sim.state.config.rounds).toBe(3);
    const short = sim.send({ type: 'startGame', playerId: 'ana', words: WORDS.slice(0, 5) });
    expect(short[0]).toMatchObject({ code: 'not-enough-words' });
    sim.send({ type: 'startGame', playerId: 'ana', words: WORDS });
    expect(sim.send({ type: 'setConfig', playerId: 'ana', rounds: 1 })[0]).toMatchObject({ code: 'not-lobby' });
  });

  it('the last word of a round opens an intermission, not the next word', () => {
    const sim = game();
    const v = sim.view('ben');
    expect([v.roundNumber, v.totalRounds, v.wordInRound]).toEqual([1, 2, 1]);
    playRound(sim);
    expect(sim.state.phase).toBe('intermission');
    expect(sim.state.word).toBeNull();
    const after = sim.view('ben');
    expect(after.roundNumber).toBe(1);
    expect(after.intermission).toMatchObject({ ready: [] });
    expect(sim.effects.some((e) => e.type === 'cue' && e.name === 'round')).toBe(true);
  });

  it('waits for the 20 s minimum even when everyone is ready at once', () => {
    const sim = game();
    playRound(sim);
    for (const id of ['ana', 'ben', 'cy', 'di']) sim.send({ type: 'ready', playerId: id });
    expect(sim.state.phase).toBe('intermission');
    sim.advance(MIN - 5);
    expect(sim.state.phase).toBe('intermission');
    sim.advance(10);
    expect(sim.state.phase).toBe('word');
    expect([sim.view('ana').roundNumber, sim.view('ana').wordInRound, sim.view('ana').wordNumber]).toEqual([2, 1, 3]);
    expect(sim.word.text).toBe('heart');
  });

  it('starts as soon as the last player is ready once the minimum has passed', () => {
    const sim = game();
    playRound(sim);
    for (const id of ['ana', 'ben', 'cy']) sim.send({ type: 'ready', playerId: id });
    sim.advance(MIN + 30 * S);
    expect(sim.state.phase).toBe('intermission');
    expect(nextDeadline(sim.state)).toBeNull(); // waiting on Di, not on a timer
    sim.send({ type: 'ready', playerId: 'di' });
    expect(sim.state.phase).toBe('word');
  });

  it('a player who is away does not hold the round up, and one who joins late does', () => {
    const sim = game();
    playRound(sim);
    sim.send({ type: 'playerDisconnected', playerId: 'di' });
    for (const id of ['ana', 'ben', 'cy']) sim.send({ type: 'ready', playerId: id });
    sim.join('ed', "Ed's");
    sim.advance(MIN + S);
    expect(sim.state.phase).toBe('intermission');
    sim.send({ type: 'ready', playerId: 'ed' });
    expect(sim.state.phase).toBe('word');
    expect(sim.word.sitOut).toEqual([]);
  });

  it('the host can start the round at once; others cannot', () => {
    const sim = game();
    playRound(sim);
    sim.host('forceNext', undefined, 'ben');
    expect(sim.state.phase).toBe('intermission');
    sim.host('forceNext');
    expect(sim.state.phase).toBe('word');
    expect(sim.state.intermission).toBeNull();
  });

  it('ready outside an intermission does nothing, and a game with nobody here does not run on', () => {
    const sim = game();
    sim.send({ type: 'ready', playerId: 'ben' });
    expect(sim.state.intermission).toBeNull();
    playRound(sim);
    for (const id of ['ana', 'ben', 'cy', 'di']) sim.send({ type: 'playerDisconnected', playerId: id });
    sim.advance(MIN * 3);
    expect(sim.state.phase).toBe('intermission');
  });

  it('there is no intermission after the last round, and a new game starts over', () => {
    const sim = game();
    playRound(sim);
    sim.host('forceNext');
    playRound(sim);
    expect(sim.state.phase).toBe('final');
    expect(sim.view('ana').awards).toEqual([]);
    sim.host('newGame');
    expect(sim.state).toMatchObject({ phase: 'lobby', roundIndex: 0, intermission: null });
  });

  it('a single round never has an intermission', () => {
    const sim = game(1);
    playRound(sim);
    expect(sim.state.phase).toBe('final');
  });
});

describe('awards', () => {
  const stats = (sim: Sim, id: string, patch: Partial<Sim['state']['players'][string]['stats']>) =>
    Object.assign(sim.state.players[id]!.stats, patch);

  it('goes to the top of each stat, shared on a tie, and skips an unearned one', () => {
    const sim = game(1);
    stats(sim, 'ana', { overruledBoos: 2, hurraysCast: 3 });
    stats(sim, 'ben', { overruledBoos: 2, hurraysCast: 1 });
    expect(awards(sim.state)).toEqual([
      { kind: 'hater', value: 2, playerIds: ['ana', 'ben'] },
      { kind: 'generous', value: 3, playerIds: ['ana'] },
    ]);
    stats(sim, 'cy', { stolenFrom: 1 });
    expect(awards(sim.state).at(-1)).toEqual({ kind: 'stolen', value: 1, playerIds: ['cy'] });
  });

  it('leaves out players the host removed', () => {
    const sim = game(1);
    stats(sim, 'di', { hurraysCast: 9 });
    sim.host('kick', 'di');
    expect(awards(sim.state)).toEqual([]);
  });
});
