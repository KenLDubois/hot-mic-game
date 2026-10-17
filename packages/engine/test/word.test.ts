import { describe, expect, it } from 'vitest';
import { room, S } from './sim.js';

describe('word states', () => {
  it('opens the first word with a 20 s grab timer', () => {
    const sim = room();
    sim.start();
    expect(sim.status).toBe('open');
    expect(sim.word.text).toBe('fire');
    expect(sim.word.deadline).toBe(sim.now + 20 * S);
  });

  it('first valid grab wins and starts singing, granting audio', () => {
    const sim = room();
    sim.start();
    sim.advance(3 * S);
    const fx = sim.grab('ben');
    expect(sim.status).toBe('singing');
    expect(sim.word.attempt?.singerId).toBe('ben');
    expect(fx).toContainEqual({ type: 'grantAudio', playerId: 'ben', attemptId: sim.attemptId });
  });

  it('rejects a second grab arriving right after the first', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.grab('cy');
    expect(sim.word.attempt?.singerId).toBe('ben');
  });

  it('rejects a grab with a stale word id', () => {
    const sim = room();
    sim.start();
    sim.send({ type: 'grab', playerId: 'ben', wordId: 'w99' });
    expect(sim.status).toBe('open');
  });

  it('skips the word when nobody grabs in 20 s', () => {
    const sim = room();
    sim.start();
    sim.advance(20 * S);
    expect(sim.status).toBe('done');
    expect(sim.word.outcome).toEqual({ kind: 'skipped' });
    expect(sim.score('ana')).toBe(0);
  });

  it('moves on to the next word after the outcome is shown', () => {
    const sim = room();
    sim.start();
    sim.advance(20 * S + 4 * S);
    expect(sim.status).toBe('open');
    expect(sim.word.text).toBe('night');
    expect(sim.word.deadline).toBe(sim.now + 20 * S);
  });

  it('holds the mic while the button is held, with no cap issue under 45 s', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.advance(30 * S);
    expect(sim.status).toBe('singing');
  });

  it('release starts a 2 s grace period and pressing within it resumes', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.advance(5 * S);
    sim.release('ben');
    expect(sim.word.attempt?.held).toBe(false);
    expect(sim.view('cy').word?.graceDeadline).toBe(sim.now + 2 * S);
    sim.advance(1900);
    sim.press('ben');
    sim.advance(10 * S);
    expect(sim.status).toBe('singing');
    expect(sim.word.attempt?.held).toBe(true);
  });

  it('ends the song when the grace period expires, moving to voting', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.advance(5 * S);
    const fx = sim.release('ben');
    expect(fx).toEqual([]);
    sim.advance(2 * S);
    expect(sim.status).toBe('voting');
    expect(sim.word.deadline).toBe(sim.now + 10 * S);
    expect(sim.effects).toContainEqual({
      type: 'revokeAudio',
      playerId: 'ben',
      attemptId: sim.attemptId,
    });
  });

  it('a press after the grace period is ignored', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2100);
    sim.press('ben');
    expect(sim.status).toBe('voting');
  });

  it('a press after the grace period is ignored even if no tick arrived', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.release('ben');
    sim.now += 2500; // no tick
    sim.press('ben');
    expect(sim.status).toBe('voting');
  });

  it('caps a song at 45 s from the first press, even while held', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.advance(44_900);
    expect(sim.status).toBe('singing');
    sim.advance(200);
    expect(sim.status).toBe('voting');
  });

  it('the cap is counted from the first press, not the last', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.advance(40 * S);
    sim.release('ben');
    sim.advance(1 * S);
    sim.press('ben');
    sim.advance(3900);
    expect(sim.status).toBe('singing');
    sim.advance(200);
    expect(sim.status).toBe('voting');
  });

  it('only the singer can press and release, with the right attempt id', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.send({ type: 'micRelease', playerId: 'cy', attemptId: sim.attemptId });
    expect(sim.word.attempt?.held).toBe(true);
    sim.send({ type: 'micRelease', playerId: 'ben', attemptId: 'a99' });
    expect(sim.word.attempt?.held).toBe(true);
  });

  it('voting closes early once every eligible voter has voted', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2 * S);
    sim.vote('ana', 'hurray');
    sim.vote('cy', 'hurray');
    expect(sim.status).toBe('voting');
    sim.vote('di', 'hurray');
    expect(sim.status).toBe('result');
  });

  it('goes to result when the 10 s voting deadline passes', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2 * S);
    sim.vote('ana', 'hurray');
    sim.advance(10 * S);
    expect(sim.status).toBe('result');
  });

  it('voting opens while singing; if all voted by then it skips straight to the result', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.vote('ana', 'hurray');
    sim.vote('cy', 'boo');
    sim.vote('di', 'hurray');
    expect(sim.status).toBe('singing');
    sim.release('ben');
    sim.advance(2 * S);
    expect(sim.status).toBe('result');
  });

  it('awards 2 points for a hurray majority and shows the result for 6 s', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2 * S);
    sim.vote('ana', 'hurray');
    sim.vote('cy', 'hurray');
    sim.vote('di', 'boo');
    expect(sim.status).toBe('result');
    expect(sim.score('ben')).toBe(2);
    expect(sim.word.result).toMatchObject({ booed: false, boos: 1, hurrays: 2, pointsAwarded: 2 });
    sim.advance(6 * S);
    expect(sim.status).toBe('done');
    expect(sim.word.outcome).toEqual({ kind: 'scored', singerId: 'ben', points: 2 });
    sim.advance(4 * S);
    expect(sim.word.text).toBe('night');
  });

  it('a tie scores for the singer', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2 * S);
    sim.vote('ana', 'boo');
    sim.vote('cy', 'hurray');
    sim.advance(10 * S);
    expect(sim.word.result?.booed).toBe(false);
    expect(sim.score('ben')).toBe(2);
  });

  it('no votes at all scores for the singer', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2 * S + 10 * S);
    expect(sim.status).toBe('result');
    expect(sim.score('ben')).toBe(2);
  });

  it('the last tap counts when a vote is changed', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.vote('ana', 'boo');
    sim.vote('ana', 'hurray');
    sim.vote('cy', 'hurray');
    sim.vote('di', 'hurray');
    sim.release('ben');
    sim.advance(2 * S);
    expect(sim.word.result).toMatchObject({ boos: 0, hurrays: 3 });
  });

  it('the singer cannot vote', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.vote('ben', 'hurray');
    expect(sim.word.attempt?.votes).toEqual({});
  });

  it('ignores votes with a stale attempt id', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.vote('ana', 'boo', 'a99');
    expect(sim.word.attempt?.votes).toEqual({});
  });

  it('ignores votes once the result is in', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2 * S + 10 * S);
    sim.vote('ana', 'boo');
    expect(sim.word.result?.votes).toEqual([]);
  });
});

describe('boo, lockout and steal', () => {
  function booedBen() {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2 * S);
    sim.vote('ana', 'boo');
    sim.vote('cy', 'boo');
    sim.vote('di', 'hurray');
    return sim;
  }

  it('a boo majority gives no point and locks the singer out', () => {
    const sim = booedBen();
    expect(sim.status).toBe('result');
    expect(sim.word.result).toMatchObject({ booed: true, pointsAwarded: 0 });
    expect(sim.score('ben')).toBe(0);
    expect(sim.word.lockedOut).toEqual(['ben']);
  });

  it('after the result there is a 3 s countdown, then a 10 s steal grab', () => {
    const sim = booedBen();
    sim.advance(6 * S);
    expect(sim.status).toBe('steal');
    expect(sim.word.deadline).toBe(sim.now + 3 * S);
    sim.advance(3 * S);
    expect(sim.status).toBe('open');
    expect(sim.word.isSteal).toBe(true);
    expect(sim.word.deadline).toBe(sim.now + 10 * S);
    expect(sim.word.text).toBe('fire');
  });

  it('the booed singer cannot grab again on that word', () => {
    const sim = booedBen();
    sim.advance(9 * S);
    expect(sim.view('ben').you.canGrab).toBe(false);
    expect(sim.view('ana').you.canGrab).toBe(true);
    sim.grab('ben');
    expect(sim.status).toBe('open');
  });

  it('the booed singer still votes on the steal', () => {
    const sim = booedBen();
    sim.advance(9 * S);
    sim.grab('cy');
    sim.vote('ben', 'hurray');
    expect(sim.word.attempt?.votes).toEqual({ ben: 'hurray' });
  });

  it('a steal that scores gives the point to the stealer and counts as stolen from', () => {
    const sim = booedBen();
    sim.advance(9 * S);
    sim.grab('cy');
    sim.release('cy');
    sim.advance(2 * S);
    sim.vote('ana', 'hurray');
    expect(sim.status).toBe('voting');
    sim.advance(10 * S);
    expect(sim.score('cy')).toBe(2);
    sim.advance(6 * S);
    expect(sim.word.outcome).toEqual({ kind: 'scored', singerId: 'cy', points: 2 });
    expect(sim.state.players.ben!.stats.stolenFrom).toBe(1);
    expect(sim.state.players.ben!.stats.timesBooed).toBe(1);
  });

  it('nobody grabbing the steal ends the word with no point', () => {
    const sim = booedBen();
    sim.advance(9 * S + 10 * S);
    expect(sim.status).toBe('done');
    expect(sim.word.outcome).toEqual({ kind: 'noPoint' });
  });

  it('can be booed repeatedly until everyone is locked out, then no point', () => {
    const sim = room();
    sim.start();
    for (const id of ['ana', 'ben', 'cy', 'di']) {
      expect(sim.status).toBe('open');
      sim.grab(id);
      sim.release(id);
      sim.advance(2 * S);
      for (const v of ['ana', 'ben', 'cy', 'di'].filter((x) => x !== id)) sim.vote(v, 'boo');
      expect(sim.word.result?.booed).toBe(true);
      sim.advance(6 * S);
      if (id !== 'di') sim.advance(3 * S);
    }
    expect(sim.status).toBe('done');
    expect(sim.word.outcome).toEqual({ kind: 'noPoint' });
    expect(sim.word.lockedOut).toHaveLength(4);
    expect(sim.state.players.ana!.score).toBe(0);
  });

  it('only connected players count as able to grab a steal', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2 * S);
    sim.vote('ana', 'boo');
    sim.vote('cy', 'boo');
    sim.send({ type: 'playerDisconnected', playerId: 'ana' });
    sim.send({ type: 'playerDisconnected', playerId: 'cy' });
    sim.send({ type: 'playerDisconnected', playerId: 'di' });
    sim.advance(6 * S);
    expect(sim.status).toBe('done');
    expect(sim.word.outcome).toEqual({ kind: 'noPoint' });
  });

  it('a skipped word is only "skipped" if nobody grabbed it; a failed steal is no point', () => {
    const sim = booedBen();
    sim.advance(6 * S + 3 * S + 10 * S);
    expect(sim.word.outcome?.kind).toBe('noPoint');
  });
});

describe('host skip and force', () => {
  it('skipWord ends an open word with nothing scored', () => {
    const sim = room();
    sim.start();
    sim.host('skipWord');
    expect(sim.status).toBe('done');
    expect(sim.word.outcome).toEqual({ kind: 'skipped' });
  });

  it('skipWord during a song revokes audio', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    const fx = sim.host('skipWord');
    expect(fx).toContainEqual({ type: 'revokeAudio', playerId: 'ben', attemptId: 'a1' });
    expect(sim.status).toBe('done');
    expect(sim.score('ben')).toBe(0);
  });

  it('skipWord during voting skips with no point', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2 * S);
    sim.host('skipWord');
    expect(sim.status).toBe('done');
    expect(sim.score('ben')).toBe(0);
  });

  it('forceNext cuts the result, steal countdown and done displays short', () => {
    const sim = room();
    sim.start();
    sim.grab('ben');
    sim.release('ben');
    sim.advance(2 * S);
    sim.vote('ana', 'hurray');
    sim.vote('cy', 'hurray');
    sim.vote('di', 'hurray');
    expect(sim.status).toBe('result');
    sim.host('forceNext');
    expect(sim.status).toBe('done');
    sim.host('forceNext');
    expect(sim.word.text).toBe('night');
  });

  it('only the host can use host actions', () => {
    const sim = room();
    sim.start();
    const fx = sim.host('skipWord', undefined, 'ben');
    expect(fx).toContainEqual(expect.objectContaining({ type: 'error', code: 'not-host' }));
    expect(sim.status).toBe('open');
  });
});
