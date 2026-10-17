import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { join } from 'node:path';
import sirv from 'sirv';
import { Server, type Socket } from 'socket.io';
import type { Effect } from '@hot-mic/engine';
import {
  clientMessages,
  type Ack,
  type ClientMessages,
  type RoomInfo,
  type ScreenSession,
  type Rules,
  type ServerEvents,
  type SessionInfo,
} from '@hot-mic/shared';
import { NoopMediaAdapter, type MediaAdapter } from './media.js';
import { loadPacks, selectWords, type LoadedPack } from './packs.js';
import { Room } from './room.js';

export interface ServerOptions {
  port?: number;
  packsDir: string;
  /** Built web app to serve, if present. */
  staticDir?: string;
  media?: MediaAdapter;
  /** Rule overrides, used by tests to run a game in milliseconds. */
  rules?: Partial<Rules>;
  now?: () => number;
}

interface SocketData {
  roomCode?: string;
  playerId?: string;
  deviceId?: string;
  /** This socket is a TV main screen, not a player. */
  screen?: boolean;
}
type GameSocket = Socket<Record<string, never>, ServerEvents, Record<string, never>, SocketData>;

type UntypedSocket = { on(event: string, fn: (...args: any[]) => void): void };

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O

export function createGameServer(opts: ServerOptions) {
  const now = opts.now ?? Date.now;
  const media = opts.media ?? new NoopMediaAdapter();
  const packs: LoadedPack[] = loadPacks(opts.packsDir);
  const rooms = new Map<string, Room>();

  const serveStatic =
    opts.staticDir && existsSync(opts.staticDir)
      ? sirv(opts.staticDir, { dev: false, single: true })
      : null;
  const indexHtml = serveStatic ? join(opts.staticDir!, 'index.html') : null;
  const http: HttpServer = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    } else if (serveStatic) {
      serveStatic(req, res, () => {
        res.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(indexHtml!));
      });
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('Hot Mic server. Build the web app to serve it from here.');
    }
  });
  const io = new Server<Record<string, never>, ServerEvents, Record<string, never>, SocketData>(http);

  function newRoom(): Room {
    let code: string;
    do {
      code = Array.from({ length: 4 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
    } while (rooms.has(code));
    const room = new Room(code, {
      packs,
      media,
      now,
      rules: opts.rules,
      onEmpty: (r) => {
        r.close();
        rooms.delete(r.code);
      },
    });
    rooms.set(code, room);
    return room;
  }

  const fail = (code: string, message: string): Ack<never> => ({ ok: false, code, message });
  const firstError = (fx: Effect[], playerId: string) =>
    fx.find((f): f is Effect & { type: 'error' } => f.type === 'error' && f.playerId === playerId);

  function bind(socket: GameSocket, room: Room, playerId: string, device?: { id: string; audio: boolean }) {
    socket.data.roomCode = room.code;
    socket.data.playerId = playerId;
    socket.data.deviceId = device?.id ?? socket.id;
    room.attach(playerId, socket, device);
  }

  io.on('connection', (socket: GameSocket) => {
    /** Validate a message against its Zod schema, then hand it to the handler. */
    function on<K extends keyof ClientMessages>(
      event: K,
      handler: (msg: ClientMessages[K], ack: (r: Ack<any>) => void) => void,
    ) {
      (socket as unknown as UntypedSocket).on(event, (raw: unknown, ackFn?: (r: Ack<any>) => void) => {
        const ack = typeof ackFn === 'function' ? ackFn : () => {};
        const parsed = clientMessages[event].safeParse(raw ?? {});
        if (!parsed.success) {
          const message = parsed.error.issues[0]?.message ?? 'Invalid message';
          socket.emit('error', { code: 'invalid', message });
          return ack(fail('invalid', message));
        }
        handler(parsed.data as ClientMessages[K], ack);
      });
    }

    /** Handler for messages that need a seat in a room. */
    function inRoom<K extends keyof ClientMessages>(
      event: K,
      handler: (msg: ClientMessages[K], room: Room, playerId: string) => Effect[] | void,
    ) {
      on(event, (msg, ack) => {
        const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined;
        const playerId = socket.data.playerId;
        if (!room || !playerId) return ack(fail('no-session', 'Join a room first'));
        const fx = handler(msg, room, playerId) ?? [];
        const err = firstError(fx, playerId);
        ack(err ? fail(err.code, err.message) : { ok: true });
      });
    }

    on('createRoom', (msg, ack) => {
      const room = newRoom();
      const added = room.addPlayer(msg.name, { name: msg.householdName });
      if ('error' in added) {
        rooms.delete(room.code);
        room.close();
        return ack(fail(added.error.code, added.error.message));
      }
      bind(socket, room, added.playerId, msg.device);
      const data: SessionInfo = { roomCode: room.code, playerId: added.playerId, token: added.token };
      ack({ ok: true, data });
    });

    on('join', (msg, ack) => {
      const room = rooms.get(msg.roomCode);
      if (!room) return ack(fail('no-room', "That room doesn't exist (any more)"));

      if (msg.token) {
        const playerId = room.playerForToken(msg.token);
        const player = playerId ? room.game.players[playerId] : undefined;
        if (playerId && player) {
          if (player.kicked) return ack(fail('kicked', 'The host removed you from the room'));
          bind(socket, room, playerId, msg.device);
          return ack({ ok: true, data: { roomCode: room.code, playerId, token: msg.token } satisfies SessionInfo });
        }
        // An unknown token falls through to a fresh join if they picked a household.
        if (!msg.householdId && !msg.householdName) {
          return ack(fail('bad-session', 'Your saved seat is gone; join again'));
        }
      }

      const household = msg.householdId ? { id: msg.householdId } : { name: msg.householdName! };
      const added = room.addPlayer(msg.name, household);
      if ('error' in added) return ack(fail(added.error.code, added.error.message));
      bind(socket, room, added.playerId, msg.device);
      ack({ ok: true, data: { roomCode: room.code, playerId: added.playerId, token: added.token } satisfies SessionInfo });
    });

    on('joinScreen', (msg, ack) => {
      const room = rooms.get(msg.roomCode);
      if (!room) return ack(fail('no-room', "That room doesn't exist (any more)"));
      const device = { id: msg.device?.id ?? socket.id, audio: msg.device?.audio ?? false };
      const error = room.attachScreen(socket as never, msg.householdId, device);
      if (error) return ack(fail('no-household', error));
      socket.data.roomCode = room.code;
      socket.data.deviceId = device.id;
      socket.data.screen = true;
      ack({ ok: true, data: { roomCode: room.code, householdId: msg.householdId } satisfies ScreenSession });
    });

    on('roomInfo', (msg, ack) => {
      const room = rooms.get(msg.roomCode);
      if (!room) return ack(fail('no-room', "That room doesn't exist (any more)"));
      const data: RoomInfo = {
        roomCode: room.code,
        phase: room.game.phase,
        households: room.game.households,
      };
      ack({ ok: true, data });
    });

    on('clockPing', (msg) => {
      (socket as Socket).emit('clockPong', { clientTime: msg.clientTime, serverTime: now() });
    });

    inRoom('setConfig', (msg, room, playerId) =>
      room.dispatch({ type: 'setConfig', playerId, wordsPerRound: msg.wordsPerRound, packIds: msg.packIds }),
    );

    inRoom('startGame', (_msg, room, playerId) => {
      const words = selectWords(packs, room.game.config.packIds);
      return room.dispatch({ type: 'startGame', playerId, words });
    });

    inRoom('grab', (msg, room, playerId) => {
      room.dispatch({ type: 'grab', playerId, wordId: msg.wordId }, socket.data.deviceId);
    });
    inRoom('micPress', (msg, room, playerId) => {
      room.dispatch({ type: 'micPress', playerId, attemptId: msg.attemptId }, socket.data.deviceId);
    });
    inRoom('micRelease', (msg, room, playerId) => {
      room.dispatch({ type: 'micRelease', playerId, attemptId: msg.attemptId });
    });
    inRoom('vote', (msg, room, playerId) => {
      room.dispatch({ type: 'vote', playerId, attemptId: msg.attemptId, vote: msg.vote });
    });
    inRoom('setSpeaker', (msg, room, playerId) => {
      const message = room.setSpeaker(playerId, msg.householdId, msg.deviceId);
      return message ? [{ type: 'error', playerId, code: 'bad-speaker', message }] : [];
    });
    // Phones and TV screens both report this.
    on('mediaConnected', (_msg, ack) => {
      const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined;
      if (!room) return ack(fail('no-session', 'Join a room first'));
      room.mediaConnected(socket as never);
      ack({ ok: true });
    });
    inRoom('hostAction', (msg, room, playerId) =>
      room.dispatch({
        type: 'hostAction',
        playerId,
        action: msg.action,
        targetId: msg.action === 'kick' ? msg.playerId : undefined,
      }),
    );

    socket.on('disconnect', () => {
      const { roomCode, playerId, screen } = socket.data;
      if (screen && roomCode) return rooms.get(roomCode)?.detachScreen(socket as never);
      if (!roomCode || !playerId) return;
      rooms.get(roomCode)?.detach(playerId, socket as never);
    });
  });

  return {
    http,
    io,
    rooms,
    listen(port = opts.port ?? 3000) {
      return new Promise<number>((resolve) => {
        http.listen(port, () => {
          const addr = http.address();
          resolve(typeof addr === 'object' && addr ? addr.port : port);
        });
      });
    },
    async close() {
      for (const room of rooms.values()) room.close();
      rooms.clear();
      await io.close();
    },
  };
}
