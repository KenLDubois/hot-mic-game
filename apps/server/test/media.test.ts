import { fileURLToPath } from 'node:url';
import { io, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Ack, MediaInfo, SessionInfo, View } from '@hot-mic/shared';
import { LiveKitMediaAdapter } from '../src/livekit.js';
import type { DevicePermissions, MediaAdapter } from '../src/media.js';
import { createGameServer } from '../src/server.js';

const packsDir = fileURLToPath(new URL('../../../packs', import.meta.url));

/** Records what the game server tells the media server. */
class FakeMedia implements MediaAdapter {
  readonly enabled = true;
  perms = new Map<string, DevicePermissions>();
  closed: string[] = [];
  async connectInfo(room: string, deviceId: string, perms: DevicePermissions) {
    this.perms.set(deviceId, perms);
    return { url: 'ws://fake', token: `${room}:${deviceId}` };
  }
  async setPermissions(_room: string, deviceId: string, perms: DevicePermissions) {
    this.perms.set(deviceId, perms);
  }
  async closeRoom(room: string) {
    this.closed.push(room);
  }
}

const RULES = { grabMs: 5000, stealGrabMs: 5000, graceMs: 100, songCapMs: 5000, voteMs: 500, stealCountdownMs: 100, resultHoldMs: 1500, doneHoldMs: 100 };

let media: FakeMedia;
let server: ReturnType<typeof createGameServer>;
let url: string;
const sockets: Socket[] = [];

beforeEach(async () => {
  media = new FakeMedia();
  server = createGameServer({ packsDir, rules: RULES, media });
  url = `http://localhost:${await server.listen(0)}`;
});
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  await server.close();
});

interface Dev {
  id: string;
  socket: Socket;
  view: View | null;
  media: MediaInfo[];
  playerId: string;
  ask: <T = undefined>(event: string, payload?: object) => Promise<Ack<T>>;
}

async function device(id: string, join: object, audio = true): Promise<Dev> {
  const socket = io(url, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  const dev: Dev = {
    id,
    socket,
    view: null,
    media: [],
    playerId: '',
    ask: (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve)),
  };
  socket.on('view', (v: View) => (dev.view = v));
  socket.on('media', (m: MediaInfo) => dev.media.push(m));
  const device = { id, audio };
  const r = await dev.ask<SessionInfo>('roomCode' in join ? 'join' : 'createRoom', { ...join, device });
  if (!r.ok) throw new Error(r.message);
  dev.playerId = r.data.playerId;
  (dev as Dev & { roomCode: string }).roomCode = r.data.roomCode;
  return dev;
}

const until = async (fn: () => unknown, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting for: ' + fn.toString());
};
const lastMedia = (d: Dev) => d.media[d.media.length - 1];

/** Annes's place has two phones (a1, a2); Ben (b1) and Cy (c1) are in their own homes. */
async function room() {
  const a1 = await device('a1', { name: 'Ann', householdName: 'Annes' });
  const code = (a1 as unknown as { roomCode: string }).roomCode;
  const a2 = await device('a2', { roomCode: code, name: 'Al', householdId: 'h1' });
  const b1 = await device('b1', { roomCode: code, name: 'Ben', householdName: 'Bens' });
  const c1 = await device('c1', { roomCode: code, name: 'Cy', householdName: 'Cys' });
  for (const d of [a1, a2, b1, c1]) await until(() => d.media.length > 0);
  return { a1, a2, b1, c1 };
}

describe('audio devices and speakers', () => {
  it('sends every audio device a token, and makes the first device in a household its speaker', async () => {
    const { a1, a2, b1, c1 } = await room();
    expect(a1.media[0]).toMatchObject({ url: 'ws://fake', token: expect.stringContaining('a1'), playRemote: true });
    expect(a2.media[0]!.playRemote).toBe(false);
    expect(b1.media[0]!.playRemote).toBe(true);
    expect(c1.media[0]!.playRemote).toBe(true);
    await until(() => a1.view?.devices.length === 4);
    expect(a1.view!.devices.filter((d) => d.speaker).map((d) => d.id).sort()).toEqual(['a1', 'b1', 'c1']);
    // Nobody can send or hear until someone sings.
    expect([...media.perms.values()].every((p) => !p.canPublish && !p.canSubscribe)).toBe(true);
  });

  it('lets a household pick another speaker, and fails over when the speaker leaves', async () => {
    const { a1, a2 } = await room();
    expect(await a1.ask('setSpeaker', { householdId: 'h1', deviceId: 'a2' })).toMatchObject({ ok: true });
    await until(() => lastMedia(a2)!.playRemote && !lastMedia(a1)!.playRemote);
    expect(a1.view!.devices.find((d) => d.id === 'a2')!.speaker).toBe(true);

    a2.socket.disconnect();
    await until(() => lastMedia(a1)!.playRemote);
    // A returning device does not take the role back.
    const back = await device('a2', { roomCode: (a1 as unknown as { roomCode: string }).roomCode, name: 'Al', token: undefined, householdId: 'h1' });
    await until(() => back.media.length > 0);
    expect(back.media[0]!.playRemote).toBe(false);
  });

  it('refuses a speaker in someone else’s household', async () => {
    const { a1 } = await room();
    expect(await a1.ask('setSpeaker', { householdId: 'h2', deviceId: 'b1' })).toMatchObject({ ok: false, code: 'bad-speaker' });
    expect(await a1.ask('setSpeaker', { householdId: 'h1', deviceId: 'b1' })).toMatchObject({ ok: false, code: 'bad-speaker' });
  });

  it('lets only the singer send, only other households hear, and takes both back after the song', async () => {
    const { a1, a2, b1, c1 } = await room();
    for (const d of [a1, a2, b1, c1]) await d.ask('mediaConnected');
    await a1.ask('startGame');
    await until(() => b1.view?.word?.status === 'open');
    expect(await b1.ask('grab', { wordId: b1.view!.word!.id })).toMatchObject({ ok: true });

    await until(() => media.perms.get('b1')?.canPublish);
    expect(media.perms.get('b1')).toEqual({ canPublish: true, canSubscribe: false }); // not their own household
    expect(media.perms.get('a1')).toEqual({ canPublish: false, canSubscribe: true }); // speaker elsewhere
    expect(media.perms.get('a2')).toEqual({ canPublish: false, canSubscribe: false }); // not the speaker
    expect(media.perms.get('c1')).toEqual({ canPublish: false, canSubscribe: true });

    await b1.ask('micPress', { attemptId: b1.view!.word!.attemptId });
    await b1.ask('micRelease', { attemptId: b1.view!.word!.attemptId });
    await until(() => b1.view!.word!.status === 'voting');
    await until(() => !media.perms.get('b1')!.canPublish);
    expect(media.perms.get('c1')!.canSubscribe).toBe(true); // still hearing the last of it

    await until(() => b1.view!.word!.status === 'result');
    await until(() => !media.perms.get('c1')!.canSubscribe);
    expect(media.perms.get('a1')!.canSubscribe).toBe(false);
  });

  it('applies permissions that changed before a device reached the media server', async () => {
    const { a1, a2, b1, c1 } = await room();
    for (const d of [a1, a2, c1]) await d.ask('mediaConnected');
    await a1.ask('startGame');
    await until(() => b1.view?.word?.status === 'open');
    await b1.ask('grab', { wordId: b1.view!.word!.id });
    await until(() => media.perms.get('a1')?.canSubscribe);
    // Ben's phone only now connects; it must be brought up to date.
    expect(media.perms.get('b1')!.canPublish).toBe(false);
    await b1.ask('mediaConnected');
    await until(() => media.perms.get('b1')!.canPublish);
  });

  it('ignores devices that cannot play audio (bots)', async () => {
    const a1 = await device('a1', { name: 'Ann', householdName: 'Annes' });
    const bot = await device('bot1', { roomCode: (a1 as unknown as { roomCode: string }).roomCode, name: 'Bot', householdId: 'h1' }, false);
    await until(() => a1.view?.devices.length === 1);
    expect(bot.media).toHaveLength(0);
    expect(a1.view!.devices[0]).toMatchObject({ id: 'a1', speaker: true });
  });

  it('sends no media and lists no devices when audio is not configured', async () => {
    await server.close();
    server = createGameServer({ packsDir, rules: RULES });
    url = `http://localhost:${await server.listen(0)}`;
    const a1 = await device('a1', { name: 'Ann', householdName: 'Annes' });
    await until(() => a1.view);
    expect(a1.view!.devices).toEqual([]);
    expect(a1.media).toHaveLength(0);
  });

  it('closes the media room when the room is discarded', async () => {
    const a1 = await device('a1', { name: 'Ann', householdName: 'Annes' });
    const code = (a1 as unknown as { roomCode: string }).roomCode;
    await server.close();
    expect(media.closed).toContain(code);
  });
});

describe('LiveKitMediaAdapter', () => {
  it('issues a token that carries the room, identity and permissions', async () => {
    const adapter = new LiveKitMediaAdapter(
      { publicUrl: 'wss://x/livekit', apiUrl: 'http://lk:7880', apiKey: 'key', apiSecret: 'secret-secret-secret-secret-123456' },
      { updateParticipant: async () => ({}), deleteRoom: async () => {} },
    );
    const info = await adapter.connectInfo('ABCD', 'dev1', { canPublish: false, canSubscribe: true });
    expect(info.url).toBe('wss://x/livekit');
    const claims = JSON.parse(Buffer.from(info.token.split('.')[1]!, 'base64url').toString());
    expect(claims.sub).toBe('dev1');
    expect(claims.video).toMatchObject({ room: 'ABCD', roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: false });
  });
});
