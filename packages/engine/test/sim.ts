import type { Rules } from '@hot-mic/shared';
import { createGame, nextDeadline, step, viewFor } from '../src/index.js';
import type { Effect, GameEvent, GameState } from '../src/index.js';

/** Drives the engine like the server does, but on a fake clock. */
export class Sim {
  state: GameState;
  now = 1_000_000;
  effects: Effect[] = [];

  constructor(rules: Partial<Rules> = {}) {
    this.state = createGame(rules);
  }

  send(event: GameEvent): Effect[] {
    const r = step(this.state, event, this.now);
    this.state = r.state;
    this.effects.push(...r.effects);
    return r.effects;
  }

  /** Move the clock forward, ticking at every deadline on the way, like the server's timer. */
  advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      const d = nextDeadline(this.state);
      if (d === null || d > target) break;
      this.now = Math.max(this.now, d);
      this.send({ type: 'tick' });
    }
    this.now = target;
    this.send({ type: 'tick' });
  }

  join(id: string, household = 'Home', name = id) {
    this.send({ type: 'playerJoined', playerId: id, name, household: { kind: 'new', name: household } });
  }

  start(words = ['fire', 'night', 'heart', 'rain', 'moon'], count = words.length, by = 'ana') {
    this.send({ type: 'setConfig', playerId: by, wordsPerRound: count });
    return this.send({ type: 'startGame', playerId: by, words });
  }

  get word() {
    return this.state.word!;
  }
  get status() {
    return this.state.word?.status;
  }
  get attemptId() {
    return this.state.word!.attempt!.id;
  }
  score(id: string) {
    return this.state.players[id]!.score;
  }
  view(id: string) {
    return viewFor(this.state, id, this.now, 'TEST');
  }

  grab(id: string) {
    return this.send({ type: 'grab', playerId: id, wordId: this.word.id });
  }
  release(id: string) {
    return this.send({ type: 'micRelease', playerId: id, attemptId: this.attemptId });
  }
  press(id: string) {
    return this.send({ type: 'micPress', playerId: id, attemptId: this.attemptId });
  }
  vote(id: string, vote: 'boo' | 'hurray', attemptId = this.attemptId) {
    return this.send({ type: 'vote', playerId: id, attemptId, vote });
  }
  host(action: 'skipWord' | 'forceNext' | 'revealTrivia' | 'newGame' | 'kick', targetId?: string, by = 'ana') {
    return this.send({ type: 'hostAction', playerId: by, action, targetId });
  }
}

/** Ana (host), Ben, Cy and Di in two households. */
export function room(rules: Partial<Rules> = {}) {
  const sim = new Sim(rules);
  sim.join('ana', "Ana's");
  sim.join('ben', "Ana's");
  sim.join('cy', "Cy's");
  sim.join('di', "Cy's");
  return sim;
}

export const S = 1000;
