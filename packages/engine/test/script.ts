import { room, S, type Sim } from './sim.js';

/**
 * Plays a whole game from a readable script, one line per action:
 *
 *   3s    ana grabs
 *   15s   ana releases
 *   16s   ben votes boo
 *
 * Times are seconds since the game started. Lines may also use `presses`,
 * `disconnects`, `connects`, and the host actions `skips` / `forces`.
 * Comments start with #.
 */
export function play(script: string, words = ['fire', 'night', 'heart', 'rain', 'moon']): Sim {
  const sim = room();
  sim.start(words, words.length);
  const t0 = sim.now;
  for (const raw of script.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = line.match(/^(\d+(?:\.\d+)?)s\s+(\w+)\s+(\w+)(?:\s+(\w+))?$/);
    if (!m) throw new Error(`Bad script line: ${raw}`);
    const [, at, who, verb, arg] = m as unknown as [string, string, string, string, string?];
    const target = t0 + Number(at) * S;
    if (target < sim.now) throw new Error(`Script line goes back in time: ${raw}`);
    sim.advance(target - sim.now);
    switch (verb) {
      case 'grabs': sim.grab(who); break;
      case 'releases': sim.release(who); break;
      case 'presses': sim.press(who); break;
      case 'votes':
        if (arg !== 'boo' && arg !== 'hurray') throw new Error(`Bad vote: ${raw}`);
        sim.vote(who, arg);
        break;
      case 'disconnects': sim.send({ type: 'playerDisconnected', playerId: who }); break;
      case 'connects': sim.send({ type: 'playerConnected', playerId: who }); break;
      case 'skips': sim.host('skipWord', undefined, who); break;
      case 'forces': sim.host('forceNext', undefined, who); break;
      default: throw new Error(`Unknown verb: ${raw}`);
    }
  }
  return sim;
}
