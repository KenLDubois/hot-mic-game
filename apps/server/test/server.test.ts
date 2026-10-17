import { fileURLToPath } from 'node:url';
import { io, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bot } from '@hot-mic/bots';
import type { Ack, SessionInfo, View } from '@hot-mic/shared';
import { createGameServer } from '../src/server.js';

const packsDir = fileURLToPath(new URL('../../../packs', import.meta.url));

// A whole game in a couple of seconds.
const FAST = {
  grabMs: 500,
  stealGrabMs: 300,
  graceMs: 100,
  songCapMs: 1500,
  voteMs: 600,
  stealCountdownMs: 100,
  resultHoldMs: 100,
  doneHoldMs: 100,
};

let server: ReturnType<typeof createGameServer>;
let url: string;
const clients: Socket[] = [];
const bots: Bot[] = [];

beforeEach(async () => {
  server = createGameServer({ packsDir, rules: FAST });
  const port = await server.listen(0);
  url = `http://localhost:${port}`;
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  bots.splice(0).forEach((b) => b.stop());
  await server.close();
});

function client(): Socket {
  const c = io(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  return c;
}
const ask = <T>(c: Socket, event: string, payload: object = {}) =>
  new Promise<Ack<T>>((resolve) => c.emit(event, payload, resolve));
const nextView = (c: Socket, pred: (v: View) => boolean = () => true) =>
  new Promise<View>((resolve) => {
    const h = (v: View) => {
      if (pred(v)) {
        c.off('view', h);
        resolve(v);
      }
    };
    c.on('view', h);
  });

describe('rooms and sessions', () => {
  it('creates a room, joins by code into a household, and rejoins with the token', async () => {
    const host = client();
    const created = await ask<SessionInfo>(host, 'createRoom', { name: 'Ken', householdName: "Ken's place" });
    expect(created.ok).toBe(true);
    const { roomCode, token } = (created as { data: SessionInfo }).data;
    expect(roomCode).toMatch(/^[A-Z]{4}$/);

    const info = await ask<{ households: { id: string; name: string }[] }>(client(), 'roomInfo', { roomCode: roomCode.toLowerCase() });
    expect(info).toMatchObject({ ok: true, data: { households: [{ id: 'h1', name: "Ken's place" }] } });

    const friend = client();
    const joined = await ask<SessionInfo>(friend, 'join', { roomCode, name: 'Ana', householdId: 'h1' });
    expect(joined.ok).toBe(true);

    // Reload: a new socket with the saved token takes the same seat.
    host.disconnect();
    const reloaded = client();
    const viewP = nextView(reloaded);
    const rejoined = await ask<SessionInfo>(reloaded, 'join', { roomCode, name: 'Ken', token });
    expect(rejoined).toMatchObject({ ok: true, data: { playerId: (created as { data: SessionInfo }).data.playerId } });
    const view = await viewP;
    expect(view.players).toHaveLength(2);
    expect(view.you.isHost).toBe(true);
    expect(view.players.find((p) => p.id === view.you.playerId)?.connected).toBe(true);
    expect(JSON.stringify(view)).not.toContain(token);
  });

  it('rejects bad codes, bad households and invalid payloads', async () => {
    const c = client();
    expect(await ask(c, 'join', { roomCode: 'ZZZZ', name: 'A', householdName: 'H' })).toMatchObject({ ok: false, code: 'no-room' });
    const created = (await ask<SessionInfo>(c, 'createRoom', { name: 'Ken', householdName: 'H' })) as { data: SessionInfo };
    const d = client();
    expect(await ask(d, 'join', { roomCode: created.data.roomCode, name: 'A', householdId: 'h9' })).toMatchObject({ ok: false, code: 'no-household' });
    expect(await ask(d, 'join', { roomCode: created.data.roomCode, name: '' , householdName: 'H' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await ask(d, 'grab', {})).toMatchObject({ ok: false });
    expect(await ask(c, 'vote', { attemptId: 'a1', vote: 'meh' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('only the host can start, and a short pack blocks start with a message', async () => {
    const host = client();
    const created = (await ask<SessionInfo>(host, 'createRoom', { name: 'Ken', householdName: 'H' })) as { data: SessionInfo };
    const guest = client();
    await ask(guest, 'join', { roomCode: created.data.roomCode, name: 'Ana', householdId: 'h1' });
    expect(await ask(guest, 'startGame')).toMatchObject({ ok: false, code: 'not-host' });
    const viewP = nextView(host, (x) => x.config.packIds[0] === 'missing');
    expect(await ask(host, 'setConfig', { wordsPerRound: 50, packIds: ['missing'] })).toMatchObject({ ok: true });
    expect(await ask(host, 'startGame')).toMatchObject({ ok: false, code: 'not-enough-words' });
    const v = await viewP;
    expect(v.startBlocked).toContain('50 words short');
  });
});

describe('a full game with bots', () => {
  it('plays a game to the end with bots filling the room', async () => {
    const make = (name: string, behavior: ConstructorParameters<typeof Bot>[0]['behavior']) =>
      new Bot({ url, name, behavior, speed: 0.04 });
    const host = make('Host', 'always-grab');
    bots.push(host, make('B1', 'normal'), make('B2', 'random-votes'), make('B3', 'booer'));
    const session = await host.create('Home');
    for (const b of bots.slice(1)) await b.join(session.roomCode, 'Away');

    const observer = client();
    await ask(observer, 'join', { roomCode: session.roomCode, name: 'Watcher', householdName: 'Away' });
    const final = nextView(observer, (v) => v.phase === 'final');
    await host.setConfig({ wordsPerRound: 3 });
    await host.startGame();

    const v = await final;
    expect(v.totalWords).toBe(3);
    const total = v.players.reduce((n, p) => n + p.score, 0);
    expect(total % 2).toBe(0); // every point is a 2-point song
    expect(v.players.every((p) => p.connected || p.kicked)).toBe(true);
  }, 30_000);
});
