import { randomBytes, randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';
import { createGame, nextDeadline, step, viewFor } from '@hot-mic/engine';
import type { Effect, GameEvent, GameState } from '@hot-mic/engine';
import { LIMITS, type Rules, type ServerEvents, type View } from '@hot-mic/shared';
import type { MediaAdapter } from './media.js';
import { availableWords, packInfo, type LoadedPack } from './packs.js';

type GameSocket = Socket<Record<string, never>, ServerEvents>;

export interface RoomDeps {
  packs: LoadedPack[];
  media: MediaAdapter;
  now: () => number;
  rules?: Partial<Rules>;
  onEmpty: (room: Room) => void;
}

/** One game: the engine state, its timer, and the sockets attached to its players. */
export class Room {
  game: GameState;
  private tokens = new Map<string, string>();
  private sockets = new Map<string, Set<GameSocket>>();
  private timer: NodeJS.Timeout | null = null;
  private discardTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    readonly code: string,
    private deps: RoomDeps,
  ) {
    this.game = createGame(deps.rules);
    this.armDiscard();
  }

  /** Apply an event, run its effects, re-arm the timer and send every device its view. */
  dispatch(event: GameEvent): Effect[] {
    if (this.closed) return [];
    const result = step(this.game, event, this.deps.now());
    this.game = result.state;
    for (const fx of result.effects) this.runEffect(fx);
    this.schedule();
    this.broadcast();
    return result.effects;
  }

  /** Add a brand-new player and return their token. */
  addPlayer(
    name: string,
    household: { id: string } | { name: string },
  ): { playerId: string; token: string } | { error: Effect & { type: 'error' } } {
    const playerId = randomUUID();
    const fx = this.dispatch({
      type: 'playerJoined',
      playerId,
      name,
      household: 'id' in household ? { kind: 'existing', id: household.id } : { kind: 'new', name: household.name },
    });
    const error = fx.find((f): f is Effect & { type: 'error' } => f.type === 'error' && f.playerId === playerId);
    if (error || !this.game.players[playerId]) {
      return { error: error ?? { type: 'error', playerId, code: 'join-failed', message: 'Could not join' } };
    }
    const token = randomBytes(24).toString('hex');
    this.tokens.set(token, playerId);
    return { playerId, token };
  }

  playerForToken(token: string): string | null {
    return this.tokens.get(token) ?? null;
  }

  attach(playerId: string, socket: GameSocket) {
    let set = this.sockets.get(playerId);
    if (!set) this.sockets.set(playerId, (set = new Set()));
    set.add(socket);
    this.cancelDiscard();
    this.dispatch({ type: 'playerConnected', playerId });
  }

  detach(playerId: string, socket: GameSocket) {
    const set = this.sockets.get(playerId);
    if (!set) return;
    set.delete(socket);
    if (set.size > 0) return;
    this.sockets.delete(playerId);
    this.dispatch({ type: 'playerDisconnected', playerId });
    if (this.sockets.size === 0) this.armDiscard();
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.discardTimer) clearTimeout(this.discardTimer);
    this.deps.media.closeRoom(this.code);
  }

  viewFor(playerId: string): View {
    const view = viewFor(this.game, playerId, this.deps.now(), this.code);
    if (this.game.phase === 'lobby') {
      view.packs = packInfo(this.deps.packs);
      view.startBlocked = this.startBlocked();
    }
    return view;
  }

  /** Why Start is blocked right now, if it is. */
  private startBlocked(): string | null {
    const g = this.game;
    const present = Object.values(g.players).filter((p) => p.connected && !p.kicked).length;
    if (present < g.rules.minPlayers) return `Need at least ${g.rules.minPlayers} players`;
    const need = g.config.rounds * g.config.wordsPerRound;
    const have = availableWords(this.deps.packs, g.config.packIds);
    if (have < need) return `The chosen packs are ${need - have} words short for ${need} words`;
    return null;
  }

  private runEffect(fx: Effect) {
    switch (fx.type) {
      case 'grantAudio':
        return this.deps.media.grantSend(this.code, fx.playerId, fx.attemptId);
      case 'revokeAudio':
        return this.deps.media.revokeSend(this.code, fx.playerId, fx.attemptId);
      case 'kicked': {
        for (const [token, id] of this.tokens) if (id === fx.playerId) this.tokens.delete(token);
        for (const socket of this.sockets.get(fx.playerId) ?? []) {
          socket.emit('error', { code: 'kicked', message: 'The host removed you from the room' });
          socket.disconnect(true);
        }
        this.sockets.delete(fx.playerId);
        return;
      }
      case 'cue':
      case 'error':
        return; // cues are for the TV (Milestone 3); errors go back through the caller's ack
    }
  }

  private broadcast() {
    for (const [playerId, set] of this.sockets) {
      if (set.size === 0) continue;
      const view = this.viewFor(playerId);
      for (const socket of set) socket.emit('view', view);
    }
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const at = nextDeadline(this.game);
    if (at === null) return;
    const delay = Math.max(1, at - this.deps.now());
    this.timer = setTimeout(() => this.dispatch({ type: 'tick' }), delay);
  }

  private armDiscard() {
    this.cancelDiscard();
    this.discardTimer = setTimeout(() => this.deps.onEmpty(this), LIMITS.roomDiscardMs);
  }

  private cancelDiscard() {
    if (this.discardTimer) clearTimeout(this.discardTimer);
    this.discardTimer = null;
  }
}
