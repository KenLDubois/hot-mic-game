import { randomBytes, randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';
import { createGame, nextDeadline, step, viewFor } from '@hot-mic/engine';
import type { Effect, GameEvent, GameState } from '@hot-mic/engine';
import { LIMITS, type DeviceView, type Rules, type ServerEvents, type View } from '@hot-mic/shared';
import type { DevicePermissions, MediaAdapter } from './media.js';
import { availableWords, packInfo, type LoadedPack } from './packs.js';

type GameSocket = Socket<Record<string, never>, ServerEvents>;

export interface RoomDeps {
  packs: LoadedPack[];
  media: MediaAdapter;
  now: () => number;
  rules?: Partial<Rules>;
  onEmpty: (room: Room) => void;
}

/** One browser tab: a player's phone, or a TV main screen (no player). Only audio-capable ones can be a speaker. */
interface Device {
  id: string;
  /** Null for a TV main screen. */
  playerId: string | null;
  householdId: string;
  audio: boolean;
  /** Order of first appearance, which decides the default speaker. */
  seq: number;
  sockets: Set<GameSocket>;
  /** Connected to the media server and ready for permission updates. */
  mediaUp: boolean;
  /** Last permissions the media server is known to have; null forces a resend. */
  applied: DevicePermissions | null;
  /** Last playRemote told to the device; undefined until its first `media` message. */
  sentPlayRemote?: boolean;
}

const samePerms = (a: DevicePermissions | null, b: DevicePermissions) =>
  !!a && a.canPublish === b.canPublish && a.canSubscribe === b.canSubscribe;

/** One game: the engine state, its timer, and the sockets attached to its players. */
export class Room {
  game: GameState;
  private tokens = new Map<string, string>();
  private sockets = new Map<string, Set<GameSocket>>();
  private timer: NodeJS.Timeout | null = null;
  private discardTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private devices = new Map<string, Device>();
  private socketDevice = new Map<GameSocket, Device>();
  /** The device each household currently plays remote audio on. */
  private speakers = new Map<string, string>();
  /** The phone each household keeps as speaker until it goes away; a TV, when there is one, overrides it. */
  private phoneSpeakers = new Map<string, string>();
  private screenSockets = new Set<GameSocket>();
  /** The device each player last grabbed or pressed from: the one that sends their voice. */
  private micDevice = new Map<string, string>();
  private deviceSeq = 0;
  private mediaQueue: Promise<void> = Promise.resolve();
  /** The connection details last sent to each device, to resend when its playRemote changes. */
  private mediaInfo = new Map<string, { url: string; token: string }>();

  constructor(
    readonly code: string,
    private deps: RoomDeps,
  ) {
    this.game = createGame(deps.rules);
    this.armDiscard();
  }

  /** Apply an event, run its effects, re-arm the timer and send every device its view. */
  dispatch(event: GameEvent, deviceId?: string): Effect[] {
    if (this.closed) return [];
    if (deviceId && (event.type === 'grab' || event.type === 'micPress')) {
      this.micDevice.set(event.playerId, deviceId);
    }
    const result = step(this.game, event, this.deps.now());
    this.game = result.state;
    for (const fx of result.effects) this.runEffect(fx);
    this.schedule();
    this.resolveSpeakers();
    this.broadcast();
    this.syncMedia();
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

  attach(playerId: string, socket: GameSocket, device?: { id: string; audio: boolean }) {
    let set = this.sockets.get(playerId);
    if (!set) this.sockets.set(playerId, (set = new Set()));
    set.add(socket);
    this.cancelDiscard();
    const d = this.registerDevice(playerId, this.game.players[playerId]?.householdId ?? '', socket, device ?? { id: socket.id, audio: false });
    this.dispatch({ type: 'playerConnected', playerId });
    if (d.audio) void this.sendMedia(d);
  }

  detach(playerId: string, socket: GameSocket) {
    const d = this.socketDevice.get(socket);
    this.socketDevice.delete(socket);
    if (d) {
      d.sockets.delete(socket);
      if (d.sockets.size === 0) {
        d.mediaUp = false;
        d.applied = null;
        d.sentPlayRemote = undefined;
      }
    }
    const set = this.sockets.get(playerId);
    if (!set) return;
    set.delete(socket);
    if (set.size > 0) return this.devicesChanged();
    this.sockets.delete(playerId);
    this.dispatch({ type: 'playerDisconnected', playerId });
    if (this.sockets.size === 0) this.armDiscard();
  }

  /** A TV main screen joins for a household and, once connected, becomes its speaker. */
  attachScreen(socket: GameSocket, householdId: string, device: { id: string; audio: boolean }): string | null {
    if (!this.game.households.some((h) => h.id === householdId)) return 'That household does not exist';
    this.screenSockets.add(socket);
    const d = this.registerDevice(null, householdId, socket, device);
    socket.emit('view', this.screenView());
    this.devicesChanged();
    if (d.audio) void this.sendMedia(d);
    return null;
  }

  detachScreen(socket: GameSocket) {
    this.screenSockets.delete(socket);
    const d = this.socketDevice.get(socket);
    this.socketDevice.delete(socket);
    if (d) {
      d.sockets.delete(socket);
      if (d.sockets.size === 0) {
        d.mediaUp = false;
        d.applied = null;
        d.sentPlayRemote = undefined;
      }
    }
    this.devicesChanged();
  }

  private screenOf(householdId: string): Device | undefined {
    return [...this.devices.values()].find((d) => d.playerId === null && d.householdId === householdId && d.audio && d.sockets.size > 0);
  }

  /** Make `deviceId` its household's speaker. Returns an error message if it can't be. */
  setSpeaker(playerId: string, householdId: string, deviceId: string): string | null {
    if (this.game.players[playerId]?.householdId !== householdId) return 'That is not your household';
    const d = this.devices.get(deviceId);
    if (!d || d.householdId !== householdId || !d.audio || d.playerId === null) return 'That device is not in your household';
    if (d.sockets.size === 0) return 'That device is not connected';
    if (this.screenOf(householdId)) return 'The TV plays the sound for your household';
    this.phoneSpeakers.set(householdId, deviceId);
    this.devicesChanged();
    return null;
  }

  /** The device has joined the media server; bring its permissions up to date. */
  mediaConnected(socket: GameSocket) {
    const d = this.socketDevice.get(socket);
    if (!d) return;
    d.mediaUp = true;
    d.applied = null;
    this.syncMedia();
  }

  private registerDevice(playerId: string | null, householdId: string, socket: GameSocket, info: { id: string; audio: boolean }): Device {
    let d = this.devices.get(info.id);
    if (d && (d.playerId !== playerId || d.householdId !== householdId)) {
      // A device id belongs to one player; a clash means a shared browser profile, so start afresh.
      this.dropDevice(d);
      d = undefined;
    }
    if (!d) {
      d = { id: info.id, playerId, householdId, audio: info.audio, seq: this.deviceSeq++, sockets: new Set(), mediaUp: false, applied: null };
      this.devices.set(d.id, d);
    }
    d.audio = info.audio;
    d.sockets.add(socket);
    this.socketDevice.set(socket, d);
    return d;
  }

  private dropDevice(d: Device) {
    for (const socket of d.sockets) this.socketDevice.delete(socket);
    this.devices.delete(d.id);
    for (const [h, id] of this.phoneSpeakers) if (id === d.id) this.phoneSpeakers.delete(h);
    for (const [p, id] of this.micDevice) if (id === d.id) this.micDevice.delete(p);
  }

  private devicesChanged() {
    this.resolveSpeakers();
    this.broadcast();
    this.syncMedia();
  }

  /**
   * A household's TV plays the sound when one is connected. Otherwise each household keeps its
   * phone speaker until that device goes away, then the next connected audio phone (in order of
   * arrival) takes over. A returning device does not take the role back.
   */
  private resolveSpeakers() {
    if (!this.deps.media.enabled) return;
    const phones = new Map<string, Device[]>();
    for (const d of [...this.devices.values()].sort((a, b) => a.seq - b.seq)) {
      if (d.playerId === null || !d.audio || d.sockets.size === 0) continue;
      const p = this.game.players[d.playerId];
      if (!p || p.kicked) continue;
      const list = phones.get(d.householdId) ?? [];
      list.push(d);
      phones.set(d.householdId, list);
    }
    for (const h of [...this.phoneSpeakers.keys()]) if (!phones.has(h)) this.phoneSpeakers.delete(h);
    for (const [h, list] of phones) {
      const cur = this.phoneSpeakers.get(h);
      if (!cur || !list.some((d) => d.id === cur)) this.phoneSpeakers.set(h, list[0]!.id);
    }
    this.speakers = new Map(this.phoneSpeakers);
    for (const d of this.devices.values()) {
      const tv = d.playerId === null ? this.screenOf(d.householdId) : undefined;
      if (tv) this.speakers.set(d.householdId, tv.id);
    }
  }

  private isSpeaker(d: Device): boolean {
    return this.speakers.get(d.householdId) === d.id;
  }

  /** Who may send and who may hear, worked out from the game state alone. */
  private desiredPermissions(d: Device): DevicePermissions {
    const w = this.game.word;
    const a = w?.attempt;
    const live = !!w && !!a && (w.status === 'singing' || w.status === 'voting');
    if (!live || !a) return { canPublish: false, canSubscribe: false };
    const singerHousehold = this.game.players[a.singerId]?.householdId;
    const own = d.householdId;
    const sendFrom = this.micDevice.get(a.singerId);
    const singerDevices = [...this.devices.values()].filter((x) => x.playerId === a.singerId && x.audio);
    const sender = singerDevices.find((x) => x.id === sendFrom && x.sockets.size > 0)?.id;
    const isSender = sender ? d.id === sender : singerDevices.some((x) => x.id === d.id);
    return {
      canPublish: w.status === 'singing' && isSender,
      canSubscribe: this.isSpeaker(d) && own !== singerHousehold,
    };
  }

  private async sendMedia(d: Device) {
    const media = this.deps.media;
    const perms = this.desiredPermissions(d);
    const info = await media.connectInfo(this.code, d.id, perms).catch(() => null);
    if (!info || this.closed || d.sockets.size === 0) return;
    d.applied = perms;
    d.sentPlayRemote = this.isSpeaker(d);
    for (const socket of d.sockets) socket.emit('media', { ...info, playRemote: d.sentPlayRemote });
    this.mediaInfo.set(d.id, info);
  }

  /** Make the media server agree with the game. Runs one pass at a time, always on the latest state. */
  private syncMedia() {
    if (!this.deps.media.enabled) return;
    this.mediaQueue = this.mediaQueue.then(() => this.syncPass()).catch(() => {});
  }

  private async syncPass() {
    if (this.closed) return;
    const jobs: Promise<void>[] = [];
    for (const d of this.devices.values()) {
      if (!d.audio || d.sockets.size === 0) continue;
      const speaker = this.isSpeaker(d);
      const info = this.mediaInfo.get(d.id);
      if (info && d.sentPlayRemote !== undefined && d.sentPlayRemote !== speaker) {
        d.sentPlayRemote = speaker;
        for (const socket of d.sockets) socket.emit('media', { ...info, playRemote: speaker });
      }
      if (!d.mediaUp) continue;
      const want = this.desiredPermissions(d);
      if (samePerms(d.applied, want)) continue;
      jobs.push(
        this.deps.media.setPermissions(this.code, d.id, want).then(
          () => void (d.applied = want),
          () => void (d.applied = null), // not in the media room (yet); mediaConnected retries
        ),
      );
    }
    await Promise.all(jobs);
  }

  private deviceViews(): DeviceView[] {
    if (!this.deps.media.enabled) return [];
    const out: DeviceView[] = [];
    for (const d of [...this.devices.values()].sort((a, b) => a.seq - b.seq)) {
      if (!d.audio) continue;
      if (d.playerId !== null) {
        const p = this.game.players[d.playerId];
        if (!p || p.kicked) continue;
      }
      out.push({
        id: d.id,
        playerId: d.playerId,
        screen: d.playerId === null,
        householdId: d.householdId,
        connected: d.sockets.size > 0,
        speaker: this.isSpeaker(d),
      });
    }
    return out;
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.discardTimer) clearTimeout(this.discardTimer);
    for (const socket of this.screenSockets) socket.emit('error', { code: 'no-room', message: 'That room has ended' });
    void this.deps.media.closeRoom(this.code).catch(() => {});
  }

  /** What a TV main screen sees: the game as no particular player, with nothing hidden from the room. */
  screenView(): View {
    const view = this.viewFor('');
    view.you.screen = true;
    return view;
  }

  viewFor(playerId: string): View {
    const view = viewFor(this.game, playerId, this.deps.now(), this.code);
    view.devices = this.deviceViews();
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
      case 'revokeAudio':
        return; // syncMedia derives who may send from the state these effects describe
      case 'kicked': {
        for (const d of [...this.devices.values()]) if (d.playerId === fx.playerId) this.dropDevice(d);
        for (const [token, id] of this.tokens) if (id === fx.playerId) this.tokens.delete(token);
        for (const socket of this.sockets.get(fx.playerId) ?? []) {
          socket.emit('error', { code: 'kicked', message: 'The host removed you from the room' });
          socket.disconnect(true);
        }
        this.sockets.delete(fx.playerId);
        return;
      }
      case 'cue':
        for (const socket of this.screenSockets) socket.emit('cue', fx.name);
        return;
      case 'error':
        return; // errors go back through the caller's ack
    }
  }

  private broadcast() {
    for (const [playerId, set] of this.sockets) {
      if (set.size === 0) continue;
      const view = this.viewFor(playerId);
      for (const socket of set) socket.emit('view', view);
    }
    if (this.screenSockets.size > 0) {
      const view = this.screenView();
      for (const socket of this.screenSockets) socket.emit('view', view);
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
