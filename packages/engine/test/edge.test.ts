import { describe, expect, it } from 'vitest';
import { LIMITS } from '@hot-mic/shared';
import { createGame, step } from '../src/index.js';
import { room, Sim, S } from './sim.js';

describe('lobby', () => {
  it('first player to join is the host', () => {
    const sim = room();
    expect(sim.state.hostId).toBe('ana');
  });

  it('players in the same household share it, matched case-insensitively', () => {
    const sim = new Sim();
    sim.join('ana', "Ana's");
    sim.join('ben', "ana's");
    expect(sim.state.households).toHaveLength(1);
    expect(sim.state.players.ben!.householdId).toBe(sim.state.players.ana!.householdId);
  });

  it('joins an existing household by id and rejects a bad one', () => {
    const sim = new Sim();
    sim.join('ana', "Ana's");
    sim.send({ type: 'playerJoined', playerId: 'ben', name: 'ben', household: { kind: 'existing', id: 'h1' } });
    expect(sim.state.players.ben!.householdId).toBe('h1');
    const fx = sim.send({ type: 'playerJoined', playerId: 'cy', name: 'cy', household: { kind: 'existing', id: 'h9' } });
    expect(fx).toContainEqual(expect.objectContaining({ code: 'no-household' }));
    expect(sim.state.players.cy).toBeUndefined();
  });

  it('adds a number to duplicate names', () => {
    const sim = new Sim();
    sim.join('p1', 'A', 'Ken');
    sim.join('p2', 'A', 'ken');
    sim.join('p3', 'A', 'Ken');
    expect(Object.values(sim.state.players).map((p) => p.name)).toEqual(['Ken', 'ken 2', 'Ken 3']);
  });

  it('only the host sets config, and only in the lobby', () => {
    const sim = room();
    let fx = sim.send({ type: 'setConfig', playerId: 'ben', wordsPerRound: 3 });
    expect(fx).toContainEqual(expect.objectContaining({ code: 'not-host' }));
    sim.send({ type: 'setConfig', playerId: 'ana', wordsPerRound: 3 });
    expect(sim.state.config.wordsPerRound).toBe(3);
    sim.start(['a', 'b', 'c'], 3);
    fx = sim.send({ type: 'setConfig', playerId: 'ana', wordsPerRound: 4 });
    expect(fx).toContainEqual(expect.objectContaining({ code: 'not-lobby' }));
    expect(sim.state.config.wordsPerRound).toBe(3);
  });

  it('rejects out-of-range word counts', () => {
    const sim = room();
    const fx = sim.send({ type: 'setConfig', playerId: 'ana', wordsPerRound: LIMITS.maxWordsPerRound + 1 });
    expect(fx).toContainEqual(expect.objectContaining({ code: 'bad-config' }));
  });

  it('start is blocked when the packs are too small, saying how many are missing', () => {
    const sim = room();
    sim.send({ type: 'setConfig', playerId: 'ana', wordsPerRound: 5 });
    const fx = sim.send({ type: 'startGame', playerId: 'ana', words: ['a', 'b'] });
    expect(fx).toContainEqual(expect.objectContaining({ code: 'not-enough-words', message: expect.stringContaining('3 words short') }));
    expect(sim.state.phase).toBe('lobby');
  });

  it('start is blocked with too few connected players', () => {
    const sim = new Sim();
    sim.join('ana', 'A');
    const fx = sim.send({ type: 'startGame', playerId: 'ana', words: ['a', 'b', 'c', 'd', 'e'] });
    expect(fx).toContainEqual(expect.objectContaining({ code: 'too-few-players' }));
  });

  it('only the host can start', () => {
    const sim = room();
    const fx = sim.send({ type: 'startGame', playerId: 'ben', words: ['a', 'b', 'c', 'd', 'e'] });
    expect(fx).toContainEqual(expect.objectContaining({ code: 'not-host' }));
  });

  it('caps the room size', () => {
    const sim = new Sim();
    for (let i = 0; i < LIMITS.maxPlayers + 1; i++) sim.join(`p${i}`, 'A');
    expect(Object.keys(sim.state.players)).toHaveLength(LIMITS.maxPlayers);
  });
});

describe('edge cases', () => {
  it('a singer who disconnects is treated as releasing; reconnecting and pressing within 2 s continues', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.advance(5 * S);
    sim.send({ type: 'playerDisconnected', playerId: 'ben' });
    expect(sim.word.attempt?.held).toBe(false);
    sim.advance(1 * S);
    sim.send({ type: 'playerConnected', playerId: 'ben' });
    sim.press('ben');
    sim.advance(5 * S);
    expect(sim.status).toBe('singing');
  });

  it('a singer who disconnects and stays away goes to voting after the grace period', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.send({ type: 'playerDisconnected', playerId: 'ben' });
    sim.advance(2 * S);
    expect(sim.status).toBe('voting');
  });

  it('a voter who disconnects is no longer waited for, and their cast vote still counts', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.vote('ana', 'boo');
    sim.release('ben');
    sim.advance(2 * S);
    sim.send({ type: 'playerDisconnected', playerId: 'ana' });
    sim.vote('cy', 'hurray');
    expect(sim.status).toBe('voting');
    sim.send({ type: 'playerDisconnected', playerId: 'di' });
    expect(sim.status).toBe('result');
    expect(sim.word.result).toMatchObject({ boos: 1, hurrays: 1 });
  });

  it('a voter disconnecting before voting is not waited for', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2 * S);
    sim.vote('ana', 'hurray');
    sim.vote('cy', 'hurray');
    sim.send({ type: 'playerDisconnected', playerId: 'di' });
    expect(sim.status).toBe('result');
  });

  it('a player joining mid-game starts at 0, sits out the current word, and can grab the next', () => {
    const sim = room();
    sim.start();
    sim.join('ed', 'Ed');
    expect(sim.score('ed')).toBe(0);
    expect(sim.view('ed').you.canGrab).toBe(false);
    sim.grab('ed');
    expect(sim.status).toBe('open');
    sim.advance(20 * S + 4 * S);
    expect(sim.word.text).toBe('night');
    expect(sim.view('ed').you.canGrab).toBe(true);
  });

  it('a mid-game joiner can vote on the current song', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.join('ed', 'Ed');
    sim.vote('ed', 'boo');
    expect(sim.word.attempt?.votes).toEqual({ ed: 'boo' });
  });

  it('a player who left stays on the board, disconnected, and is not waited for', () => {
    const sim = room();
    sim.start();
    sim.send({ type: 'playerDisconnected', playerId: 'di' });
    const v = sim.view('ana');
    expect(v.players.find((p) => p.id === 'di')).toMatchObject({ connected: false, kicked: false });
    sim.send({ type: 'playerConnected', playerId: 'di' });
    expect(sim.view('ana').players.find((p) => p.id === 'di')?.connected).toBe(true);
  });

  it('the host can kick a player; kicked players cannot grab or reconnect', () => {
    const sim = room();
    sim.start();
    const fx = sim.host('kick', 'di');
    expect(fx).toContainEqual({ type: 'kicked', playerId: 'di' });
    sim.send({ type: 'playerConnected', playerId: 'di' });
    expect(sim.state.players.di!.connected).toBe(false);
    sim.grab('di');
    expect(sim.status).toBe('open');
  });

  it('cannot kick yourself', () => {
    const sim = room();
    const fx = sim.host('kick', 'ana');
    expect(fx).toContainEqual(expect.objectContaining({ code: 'bad-kick' }));
  });

  it('kicking the singer ends the song', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    const fx = sim.host('kick', 'ben');
    expect(sim.status).toBe('voting');
    expect(fx).toContainEqual({ type: 'revokeAudio', playerId: 'ben', attemptId: 'a1' });
  });

  it('host controls pass to the longest-connected player after 30 s away', () => {
    const sim = new Sim();
    sim.join('ana', 'A');
    sim.join('ben', 'A');
    sim.advance(1 * S);
    sim.join('cy', 'A');
    sim.send({ type: 'playerDisconnected', playerId: 'ana' });
    sim.advance(29 * S);
    expect(sim.state.hostId).toBe('ana');
    sim.advance(1 * S);
    expect(sim.state.hostId).toBe('ben');
  });

  it('host controls stay if the host returns within 30 s', () => {
    const sim = room();
    sim.send({ type: 'playerDisconnected', playerId: 'ana' });
    sim.advance(20 * S);
    sim.send({ type: 'playerConnected', playerId: 'ana' });
    sim.advance(60 * S);
    expect(sim.state.hostId).toBe('ana');
  });

  it('when everyone is away the host role waits for the next connection', () => {
    const sim = new Sim();
    sim.join('ana', 'A');
    sim.join('ben', 'A');
    sim.send({ type: 'playerDisconnected', playerId: 'ana' });
    sim.send({ type: 'playerDisconnected', playerId: 'ben' });
    sim.advance(60 * S);
    expect(sim.state.hostId).toBe('ana');
    sim.send({ type: 'playerConnected', playerId: 'ben' });
    expect(sim.state.hostId).toBe('ben');
  });

  it('a new host can run host actions', () => {
    const sim = room();
    sim.start();
    sim.send({ type: 'playerDisconnected', playerId: 'ana' });
    sim.advance(30 * S);
    sim.host('skipWord', undefined, 'ben');
    expect(sim.status).toBe('done');
  });

  it('with nobody connected the game keeps running and words time out', () => {
    const sim = room();
    sim.start(['a', 'b'], 2);
    for (const id of ['ana', 'ben', 'cy', 'di']) sim.send({ type: 'playerDisconnected', playerId: id });
    sim.advance(2 * (20 + 4) * S);
    expect(sim.state.phase).toBe('final');
  });
});

describe('game end', () => {
  it('goes to final after the last word, then newGame resets to the lobby', () => {
    const sim = room();
    sim.start(['a', 'b'], 2);
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2 * S);
    sim.vote('ana', 'hurray');
    sim.vote('cy', 'hurray');
    sim.vote('di', 'hurray');
    sim.advance(6 * S + 4 * S);
    expect(sim.word.text).toBe('b');
    expect(sim.state.wordIndex).toBe(1);
    sim.advance(20 * S + 4 * S);
    expect(sim.state.phase).toBe('final');
    expect(sim.view('ana').word).toBeNull();
    expect(sim.score('ben')).toBe(2);
    sim.host('newGame');
    expect(sim.state.phase).toBe('lobby');
    expect(sim.score('ben')).toBe(0);
    expect(sim.state.players.ben!.stats.hurraysCast).toBe(0);
    sim.start(['x', 'y', 'z'], 3);
    expect(sim.word.text).toBe('x');
  });

  it('uses the words count the host picked even if more words are offered', () => {
    const sim = room();
    sim.start(['a', 'b', 'c', 'd', 'e', 'f'], 2);
    expect(sim.state.words).toEqual(['a', 'b']);
  });
});

describe('stats and views', () => {
  function playOne(sim: Sim, votes: Record<string, 'boo' | 'hurray'>) {
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2 * S);
    for (const [id, v] of Object.entries(votes)) sim.vote(id, v);
  }

  it('counts boos cast, hurrays and overruled boos', () => {
    const sim = room();
    sim.start();
    playOne(sim, { ana: 'boo', cy: 'hurray', di: 'hurray' });
    const p = sim.state.players;
    expect(p.ana!.stats).toMatchObject({ boosCast: 1, overruledBoos: 1, hurraysCast: 0 });
    expect(p.cy!.stats).toMatchObject({ hurraysCast: 1, boosCast: 0 });
  });

  it('boos that win are not overruled', () => {
    const sim = room();
    sim.start();
    playOne(sim, { ana: 'boo', cy: 'boo', di: 'hurray' });
    expect(sim.state.players.ana!.stats).toMatchObject({ boosCast: 1, overruledBoos: 0 });
  });

  it('hides other players\' votes until the result, but shows a device its own', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.vote('ana', 'boo');
    sim.vote('cy', 'hurray');
    const json = JSON.stringify(sim.view('di'));
    expect(sim.view('di').word?.voteCount).toBe(2);
    expect(sim.view('di').you.vote).toBeNull();
    expect(sim.view('ana').you.vote).toBe('boo');
    expect(sim.view('di').word?.result).toBeNull();
    expect(json).not.toContain('"boo"');
    sim.release('ben');
    sim.advance(2 * S);
    sim.vote('di', 'hurray');
    const after = sim.view('di').word!;
    expect(after.status).toBe('result');
    expect(after.result?.votes).toEqual(
      expect.arrayContaining([
        { playerId: 'ana', vote: 'boo' },
        { playerId: 'cy', vote: 'hurray' },
        { playerId: 'di', vote: 'hurray' },
      ]),
    );
  });

  it('views never carry player tokens (the engine has none) and include server time', () => {
    const sim = room();
    expect(sim.view('ana').serverTime).toBe(sim.now);
    expect(JSON.stringify(sim.view('ana'))).not.toMatch(/token/i);
  });

  it('is pure: step does not mutate the previous state', () => {
    const g = createGame();
    const r = step(g, { type: 'playerJoined', playerId: 'a', name: 'A', household: { kind: 'new', name: 'H' } }, 0);
    expect(g.playerOrder).toEqual([]);
    expect(r.state.playerOrder).toEqual(['a']);
  });
});
