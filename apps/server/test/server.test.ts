import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { io, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bot } from '@hot-mic/bots';
import type { Ack, SessionInfo, View } from '@hot-mic/shared';
import { loadPacks } from '../src/packs.js';
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
  intermissionMinMs: 300,
  triviaRevealMs: 200,
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

  it('runs two rounds with an intermission where everyone taps Ready', async () => {
    const host = new Bot({ url, name: 'Host', behavior: 'always-grab', speed: 0.04 });
    const other = new Bot({ url, name: 'B1', behavior: 'normal', speed: 0.04 });
    bots.push(host, other);
    const session = await host.create('Home');
    await other.join(session.roomCode, 'Away');

    // A human-ish observer who has to tap Ready like everyone else.
    const observer = client();
    await ask(observer, 'join', { roomCode: session.roomCode, name: 'Watcher', householdName: 'Away' });
    const phases: string[] = [];
    observer.on('view', (v: View) => {
      if (phases.at(-1) !== v.phase) phases.push(v.phase);
      if (v.phase === 'intermission' && !v.you.ready) void ask(observer, 'ready');
    });
    const final = nextView(observer, (v) => v.phase === 'final');
    await host.setConfig({ rounds: 2, wordsPerRound: 2 });
    await host.startGame();

    const v = await final;
    expect(phases).toEqual(['lobby', 'word', 'intermission', 'word', 'final']);
    expect(v.totalRounds).toBe(2);
    expect(v.totalWords).toBe(4);
  }, 30_000);

  it('asks trivia between rounds and bots answer it', async () => {
    const host = new Bot({ url, name: 'Host', behavior: 'always-grab', speed: 0.04 });
    const other = new Bot({ url, name: 'B1', behavior: 'normal', speed: 0.04 });
    bots.push(host, other);
    const session = await host.create('Home');
    await other.join(session.roomCode, 'Away');
    const observer = client();
    await ask(observer, 'join', { roomCode: session.roomCode, name: 'Watcher', householdName: 'Away' });
    const stages: string[] = [];
    observer.on('view', (v: View) => {
      const im = v.intermission;
      if (im && stages.at(-1) !== im.stage) stages.push(im.stage);
      if (im?.stage === 'question' && !v.you.answered) void ask(observer, 'triviaAnswer', { questionId: im.trivia!.id, choice: 0 });
      if (im?.stage === 'leaderboard' && !v.you.ready) void ask(observer, 'ready');
    });
    const final = nextView(observer, (v) => v.phase === 'final');
    await host.setConfig({ rounds: 2, wordsPerRound: 2, trivia: true });
    await host.startGame();
    const v = await final;
    expect(stages).toEqual(['question', 'reveal', 'leaderboard']);
    expect(v.totalRounds).toBe(2);
  }, 30_000);

  it('checks and previews packs, and adds an uploaded pack only for the host', async () => {
    const host = client();
    const created = (await ask<SessionInfo>(host, 'createRoom', { name: 'Ken', householdName: 'Home' })) as { data: SessionInfo };
    const guest = client();
    await ask(guest, 'join', { roomCode: created.data.roomCode, name: 'Ana', householdId: 'h1' });
    const pack = JSON.stringify({ schemaVersion: 1, type: 'trivia', name: 'Mine', questions: [{ question: 'Q?', choices: ['a', 'b'], answer: 1 }] });
    const bad = JSON.stringify({ schemaVersion: 1, type: 'trivia', name: 'Bad', questions: [{ question: 'Q?', choices: ['a', 'b'] }] });

    expect(await ask(guest, 'uploadPack', { text: pack })).toMatchObject({ ok: false, code: 'not-host' });
    expect(await ask(host, 'previewPack', { text: bad })).toMatchObject({
      ok: false,
      code: 'bad-pack',
      message: expect.stringContaining('Question 1 has no correct answer'),
    });
    expect(await ask(host, 'previewPack', { text: pack })).toMatchObject({ ok: true, data: { kind: 'trivia', count: 1 } });
    expect(await ask(host, 'previewPack', { packId: 'starter' })).toMatchObject({ ok: true, data: { kind: 'words' } });
    expect(await ask(host, 'previewPack', { packId: 'nope' })).toMatchObject({ ok: false });

    const withPack = nextView(host, (v) => !!v.packs?.some((p) => p.uploaded));
    expect(await ask(host, 'uploadPack', { text: pack })).toMatchObject({ ok: true, data: { id: 'upload-1' } });
    const v = await withPack;
    expect(v.packs?.find((p) => p.id === 'upload-1')).toMatchObject({ kind: 'trivia', count: 1, uploaded: true });
    expect(v.config.triviaPackIds).toContain('upload-1');
    expect(v.packs?.some((p) => p.id === 'music-trivia' && p.kind === 'trivia' && p.count > 40)).toBe(true);
  });

  it('blocks Start when the trivia packs are too small', async () => {
    const host = client();
    const created = (await ask<SessionInfo>(host, 'createRoom', { name: 'Ken', householdName: 'Home' })) as { data: SessionInfo };
    const guest = client();
    await ask(guest, 'join', { roomCode: created.data.roomCode, name: 'Ana', householdId: 'h1' });
    const blocked = nextView(host, (v) => !!v.startBlocked?.includes('trivia'));
    await ask(host, 'setConfig', { rounds: 10, wordsPerRound: 1, trivia: true, triviaPackIds: ['missing'] });
    expect((await blocked).startBlocked).toBe('The trivia packs are 9 questions short for 9 questions');
    // One round never has an intermission, so it needs no questions.
    const ok = nextView(host, (v) => v.startBlocked === null);
    await ask(host, 'setConfig', { rounds: 1 });
    await ok;
  });
});

describe('theme packs', () => {
  const wav = Uint8Array.from([...'RIFF', 0, 0, 0, 0, ...'WAVE'].map((c) => (typeof c === 'string' ? c.charCodeAt(0) : c)));
  const svg = strToU8('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
  const manifest = (over: object = {}) => ({
    schemaVersion: 1,
    type: 'theme',
    name: 'Spooky',
    words: [{ text: 'ghost' }, { text: 'moon' }],
    style: { colors: { primary: '#ffaa00' }, font: 'serif', background: 'bg.svg', sounds: { boo: 'sounds/boo.wav' } },
    ...over,
  });
  const zip = (files: Record<string, Uint8Array | object>) =>
    zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v instanceof Uint8Array ? v : strToU8(JSON.stringify(v))])));
  const good = () => zip({ 'theme.json': manifest(), 'bg.svg': svg, 'sounds/boo.wav': wav });

  async function room() {
    const host = client();
    const created = (await ask<SessionInfo>(host, 'createRoom', { name: 'Ken', householdName: 'Home' })) as { data: SessionInfo };
    const guest = client();
    await ask(guest, 'join', { roomCode: created.data.roomCode, name: 'Ana', householdId: 'h1' });
    return { host, guest, code: created.data.roomCode };
  }

  it('ships a valid built-in Halloween theme', async () => {
    const { host, code } = await room();
    const themed = nextView(host, (x) => x.theme?.id === 'halloween');
    await ask(host, 'setConfig', { themeId: 'halloween' });
    const view = await themed;
    const halloween = view.packs?.find((p) => p.id === 'halloween');
    expect(halloween).toMatchObject({ kind: 'theme', uploaded: false });
    expect(halloween!.count).toBeGreaterThan(30);
    expect(view.theme).toMatchObject({ name: 'Halloween', font: 'display', background: '/theme-assets/builtin/halloween/background.svg' });
    expect(view.theme!.sounds.boo).toBe('/theme-assets/builtin/halloween/sounds/boo.wav');

    const res = await fetch(`${url}${view.theme!.background}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect((await fetch(`${url}/theme-assets/builtin/halloween/theme.json`)).status).toBe(404);
    expect((await fetch(`${url}/theme-assets/builtin/halloween/..%2F..%2Fstarter.json`)).status).toBe(404);
    expect(code).toMatch(/^[A-Z]{4}$/);
  });

  it('previews a theme zip, then host adds it and everyone gets its look', async () => {
    const { host, guest, code } = await room();
    expect(await ask(guest, 'uploadPack', { data: good() })).toMatchObject({ ok: false, code: 'not-host' });
    expect(await ask(host, 'previewPack', { data: good() })).toMatchObject({
      ok: true,
      data: { kind: 'theme', count: 2, font: 'serif', background: true, sounds: ['boo'] },
    });

    const seen = nextView(guest, (x) => x.theme?.id === 'upload-1');
    expect(await ask(host, 'uploadPack', { data: good() })).toMatchObject({ ok: true, data: { id: 'upload-1' } });
    const view = await seen;
    expect(view.config.themeId).toBe('upload-1');
    expect(view.theme).toMatchObject({ name: 'Spooky', colors: { primary: '#ffaa00' }, background: `/theme-assets/${code}/upload-1/bg.svg` });
    expect((await fetch(`${url}${view.theme!.background}`)).status).toBe(200);
    expect((await fetch(`${url}/theme-assets/ZZZZ/upload-1/bg.svg`)).status).toBe(404);
  });

  it("counts a theme's words toward Start", async () => {
    const { host } = await room();
    await ask(host, 'uploadPack', { data: zip({ 'theme.json': manifest({ style: undefined, words: undefined }) }) });
    const big = nextView(host, (x) => x.config.wordsPerRound === 50 && x.config.packIds[0] === 'nothing');
    await ask(host, 'setConfig', { wordsPerRound: 50, packIds: ['nothing'] });
    expect((await big).startBlocked).toContain('50 words short');

    const withTheme = nextView(host, (x) => x.startBlocked === 'The chosen packs are 48 words short for 50 words');
    await ask(host, 'uploadPack', { data: zip({ 'theme.json': manifest({ style: undefined }) }) });
    await withTheme;
  });

  it('says exactly what is wrong with a bad theme zip', async () => {
    const { host } = await room();
    const errorsFor = async (data: Uint8Array) => {
      const r = await ask(host, 'previewPack', { data });
      if (r.ok) throw new Error('expected a rejection');
      return r.message.split('\n');
    };
    expect(await errorsFor(strToU8('not a zip'))).toEqual(['That is not a valid zip file']);
    expect(await errorsFor(zip({ 'readme.txt': strToU8('hi') }))).toEqual(['The zip has no theme.json at its top level']);
    expect(await errorsFor(zip({ 'theme.json': manifest(), 'bg.svg': svg }))).toEqual(['Sound "boo" points to "sounds/boo.wav", which is not in the pack']);
    expect(await errorsFor(zip({ 'theme.json': manifest(), 'bg.svg': strToU8('<svg><script>alert(1)</script></svg>'), 'sounds/boo.wav': wav }))).toEqual([
      '"bg.svg" contains scripts, which are not allowed',
    ]);
    expect(await errorsFor(zip({ 'theme.json': manifest(), 'bg.svg': svg, 'sounds/boo.wav': strToU8('not audio at all') }))).toEqual([
      '"sounds/boo.wav" is not really a .wav file',
    ]);
    expect((await errorsFor(zip({ 'theme.json': manifest({ style: { css: 'x' } }) })))[0]).toMatch(/tokens only/);
  });

  it('accepts a zip made by zipping a folder', async () => {
    const { host } = await room();
    const nested = zip({ 'Spooky/theme.json': manifest(), 'Spooky/bg.svg': svg, 'Spooky/sounds/boo.wav': wav, '__MACOSX/Spooky/._theme.json': wav });
    expect(await ask(host, 'previewPack', { data: nested })).toMatchObject({ ok: true, data: { kind: 'theme' } });
  });

  it('refuses a zip that unpacks too big', async () => {
    const { host } = await room();
    const bomb = zip({ 'theme.json': manifest(), 'bg.svg': new Uint8Array(3_900_000).fill(32), 'sounds/boo.wav': wav, 'pad.bin': new Uint8Array(300_000) });
    const r = await ask(host, 'previewPack', { data: bomb });
    expect(r).toMatchObject({ ok: false, code: 'bad-pack' });
  });

  it('a bare theme.json cannot point to files', async () => {
    const { host } = await room();
    const r = await ask(host, 'previewPack', { text: JSON.stringify(manifest()) });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('Upload a .zip') });
    expect(await ask(host, 'previewPack', { text: JSON.stringify(manifest({ style: { font: 'mono' } })) })).toMatchObject({ ok: true, data: { kind: 'theme' } });
  });
});

describe('built-in packs', () => {
  it('all load, and every trivia question has a source or an unconfirmed flag', () => {
    const packs = loadPacks(packsDir);
    expect(packs.map((p) => p.id)).toEqual(expect.arrayContaining(['starter', 'music-trivia', 'halloween']));
    const trivia = packs.find((p) => p.id === 'music-trivia')!.pack;
    if (trivia.type !== 'trivia') throw new Error('music-trivia should be a trivia pack');
    expect(trivia.questions.filter((q) => !q.source && !q.unconfirmed)).toEqual([]);
  });
});
