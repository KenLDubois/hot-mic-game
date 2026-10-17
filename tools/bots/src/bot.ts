import { io, type Socket } from 'socket.io-client';
import type { Ack, SessionInfo, View, Vote } from '@hot-mic/shared';

export type Behavior =
  | 'normal'
  | 'always-grab'
  | 'never-grab'
  | 'never-vote'
  | 'random-votes'
  | 'booer'
  | 'hurrayer'
  | 'disconnect-mid-song';

export const BEHAVIORS: Behavior[] = [
  'normal',
  'always-grab',
  'never-grab',
  'never-vote',
  'random-votes',
  'booer',
  'hurrayer',
  'disconnect-mid-song',
];

export interface BotOptions {
  url: string;
  name: string;
  behavior: Behavior;
  /** Scales every delay; tests use a small number. */
  speed?: number;
  log?: (msg: string) => void;
}

const between = (min: number, max: number) => min + Math.random() * (max - min);

/** A fake player over a real socket, so a room can be filled while one phone is tested. */
export class Bot {
  readonly name: string;
  session: SessionInfo | null = null;
  view: View | null = null;
  private socket: Socket;
  private planned = new Set<string>();
  private timers = new Set<NodeJS.Timeout>();
  private stopped = false;

  constructor(private opts: BotOptions) {
    this.name = opts.name;
    this.socket = io(opts.url, { transports: ['websocket'], reconnection: true });
    this.socket.on('view', (v: View) => {
      this.view = v;
      this.react(v);
    });
    this.socket.on('connect', () => {
      // Reconnects restore the seat with the saved token.
      if (this.session) {
        this.socket.emit('join', {
          roomCode: this.session.roomCode,
          name: this.name,
          token: this.session.token,
        });
      }
    });
  }

  private log(msg: string) {
    this.opts.log?.(`[${this.name}] ${msg}`);
  }

  private ask<T>(event: string, payload: object): Promise<T> {
    return new Promise((resolve, reject) => {
      this.socket.emit(event, payload, (r: Ack<T>) => {
        if (r.ok) resolve((r as { data: T }).data);
        else reject(new Error(`${r.code}: ${r.message}`));
      });
    });
  }

  async create(householdName: string): Promise<SessionInfo> {
    this.session = await this.ask<SessionInfo>('createRoom', { name: this.name, householdName });
    return this.session;
  }

  async join(roomCode: string, householdName: string): Promise<SessionInfo> {
    this.session = await this.ask<SessionInfo>('join', { roomCode, name: this.name, householdName });
    return this.session;
  }

  /** Host-only helpers, so a headless run can start its own game. */
  setConfig(config: object) {
    return this.ask('setConfig', config);
  }
  startGame() {
    return this.ask('startGame', {});
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.socket.disconnect();
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.stopped) fn();
    }, ms * (this.opts.speed ?? 1));
    this.timers.add(t);
  }

  private once(key: string, fn: () => void): boolean {
    if (this.planned.has(key)) return false;
    this.planned.add(key);
    fn();
    return true;
  }

  private react(v: View) {
    if (v.phase === 'intermission' && !v.you.ready && this.opts.behavior !== 'never-vote') {
      this.once(`ready:${v.roundNumber}`, () => this.later(between(1000, 6000), () => this.socket.emit('ready', {})));
      return;
    }
    const w = v.word;
    if (v.phase !== 'word' || !w) return;
    const me = v.you.playerId;
    const b = this.opts.behavior;

    if (w.status === 'open' && v.you.canGrab && b !== 'never-grab') {
      this.once(`grab:${w.id}:${w.isSteal}`, () => {
        const delay = b === 'always-grab' ? between(0, 150) : between(500, 6000);
        this.later(delay, () => {
          this.log(`grabbing "${w.text}"`);
          this.socket.emit('grab', { wordId: w.id });
        });
      });
    }

    if (w.status === 'singing' && w.singerId === me && w.attemptId) {
      const attemptId = w.attemptId;
      this.once(`sing:${attemptId}`, () => {
        if (b === 'disconnect-mid-song') {
          this.later(between(1500, 4000), () => {
            this.log('dropping the connection mid-song');
            this.socket.disconnect();
            this.later(5000, () => this.socket.connect());
          });
          return;
        }
        this.later(between(3000, 9000), () => {
          this.log('finishing the song');
          this.socket.emit('micRelease', { attemptId });
        });
      });
    }

    if ((w.status === 'singing' || w.status === 'voting') && w.singerId !== me && w.attemptId) {
      const attemptId = w.attemptId;
      if (b !== 'never-vote' && v.you.vote === null) {
        this.once(`vote:${attemptId}`, () => {
          this.later(between(800, 5000), () => {
            const vote: Vote =
              b === 'booer' ? 'boo' : b === 'hurrayer' ? 'hurray' : Math.random() < 0.35 ? 'boo' : 'hurray';
            this.log(`voting ${vote}`);
            this.socket.emit('vote', { attemptId, vote });
          });
        });
      }
    }
  }
}
