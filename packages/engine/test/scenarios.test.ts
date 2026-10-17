import { describe, expect, it } from 'vitest';
import { play } from './script.js';
import { S } from './sim.js';

const scores = (sim: ReturnType<typeof play>) =>
  Object.fromEntries(Object.values(sim.state.players).map((p) => [p.id, p.score]));

describe('scripted games', () => {
  it('Ana is booed, Ben steals and scores', () => {
    const sim = play(`
      3s   ana grabs
      15s  ana releases           # grace ends at 17 s, voting opens
      18s  ben votes boo
      18s  cy votes boo
      19s  di votes hurray        # everyone has voted: result at 19 s
      29s  ben grabs              # result to 25 s, countdown to 28 s, steal open from 28 s
      31s  ben releases
      34s  ana votes hurray
      34s  cy votes hurray
      34s  di votes hurray
    `);
    expect(scores(sim)).toEqual({ ana: 0, ben: 2, cy: 0, di: 0 });
    expect(sim.state.players.ana!.stats.timesBooed).toBe(1);
    expect(sim.state.players.ana!.stats.stolenFrom).toBe(0); // counted when the word closes
    sim.advance(10 * S);
    expect(sim.state.players.ana!.stats.stolenFrom).toBe(1);
    expect(sim.state.players.ben!.stats.overruledBoos).toBe(0);
    expect(sim.state.players.cy!.stats.boosCast).toBe(1);
    expect(sim.state.players.cy!.stats.overruledBoos).toBe(0); // that boo won
    expect(sim.state.players.di!.stats.hurraysCast).toBe(2);
  });

  it('a nervous singer lets go and resumes inside the grace ring, twice', () => {
    const sim = play(`
      1s   cy grabs
      6s   cy releases
      7s   cy presses
      12s  cy releases
      13.5s cy presses
      18s  cy releases
    `);
    expect(sim.status).toBe('singing');
    sim.advance(2 * S);
    expect(sim.status).toBe('voting');
  });

  it('the singer drops out and the song ends after the grace period, then the room votes', () => {
    const sim = play(`
      2s   di grabs
      9s   di disconnects
      14s  ana votes hurray
      14s  ben votes hurray
      14s  cy votes boo
    `);
    expect(sim.status).toBe('result');
    expect(scores(sim).di).toBe(2);
  });

  it('three words: a skip, a no-grab and a clean win, ending in Final', () => {
    const sim = play(
      `
      1s   ana skips              # host skips "fire"
      5s   ben grabs              # "night" is open at 5 s (done 1-5 s)
      6s   ben releases
      9s   ana votes hurray
      9s   cy votes hurray
      9s   di votes hurray
      `,
      ['fire', 'night', 'heart'],
    );
    expect(sim.word.text).toBe('night');
    sim.advance(6 * S + 4 * S);
    expect(sim.word.text).toBe('heart');
    sim.advance(20 * S + 4 * S);
    expect(sim.state.phase).toBe('final');
    expect(scores(sim)).toEqual({ ana: 0, ben: 2, cy: 0, di: 0 });
  });

  it('a 45 s song with a late press near the cap ends exactly at the cap', () => {
    const sim = play(`
      0.5s ana grabs
      44s  ana releases
      44.5s ana presses
    `);
    expect(sim.status).toBe('singing');
    sim.advance(1 * S); // 45.5 s elapsed from the grab at 0.5 s
    expect(sim.status).toBe('voting');
  });
});
