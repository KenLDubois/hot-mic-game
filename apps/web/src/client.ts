import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientMessages, MediaInfo, RoomInfo, SessionInfo, View } from '@hot-mic/shared';
import { AudioSession, type AudioState } from './audio';

const STORAGE_KEY = 'hotmic.session';

interface Saved {
  roomCode: string;
  token: string;
  name: string;
}

export interface ClientState {
  connected: boolean;
  /** Trying to restore a saved seat. */
  restoring: boolean;
  view: View | null;
  /** A message to show on the home screen (kicked, room gone). */
  notice: string | null;
}

/** Stable for this tab across reloads, so a reload keeps its speaker role. */
const deviceId = (): string => {
  try {
    let id = sessionStorage.getItem('hotmic.device');
    if (!id) sessionStorage.setItem('hotmic.device', (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
};

const load = (): Saved | null => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null;
  }
};
const save = (s: Saved | null) => {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: the game works, a reload just can't rejoin.
  }
};

/** The one socket to the game server, the saved seat, and the clock offset. */
class GameClient {
  private socket: Socket;
  private listeners = new Set<() => void>();
  private saved = load();
  private offset = 0;
  private bestRtt = Infinity;
  readonly deviceId = deviceId();
  readonly audio = new AudioSession();
  private wakeLock: WakeLockSentinel | null = null;
  state: ClientState = {
    connected: false,
    restoring: !!this.saved,
    view: null,
    notice: null,
  };

  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'] });
    this.socket.on('connect', () => {
      this.set({ connected: true });
      this.ping();
      if (this.saved) void this.rejoin(this.saved);
    });
    this.socket.on('disconnect', () => this.set({ connected: false }));
    this.socket.on('media', (info: MediaInfo) => void this.audio.connect(info));
    this.audio.onConnected = () => void this.request('mediaConnected', {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.state.view) void this.keepAwake();
    });
    this.socket.on('view', (view: View) => {
      if (!this.state.view) void this.keepAwake();
      this.set({ view, notice: null });
    });
    this.socket.on('clockPong', (m: { clientTime: number; serverTime: number }) => {
      const rtt = Date.now() - m.clientTime;
      // The sample with the shortest round trip is the most trustworthy one.
      if (rtt <= this.bestRtt + 20) {
        this.bestRtt = Math.min(this.bestRtt, rtt);
        this.offset = m.serverTime + rtt / 2 - Date.now();
      }
    });
    this.socket.on('error', (e: { code: string; message: string }) => {
      if (e.code === 'kicked') this.leave(e.message);
    });
    setInterval(() => this.ping(), 30_000);
  }

  private get device() {
    return { id: this.deviceId, audio: true };
  }

  /** Keep the screen on while in a room, so a phone acting as the speaker doesn't fall asleep. */
  private async keepAwake() {
    try {
      if (this.wakeLock && !this.wakeLock.released) return;
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      // Not supported, or the battery saver said no. The game still works.
    }
  }

  /** Call from a tap (such as Join): browsers allow sound only after the user has interacted. */
  unlockAudio() {
    this.audio.unlock();
  }

  private ping() {
    if (this.socket.connected) this.socket.emit('clockPing', { clientTime: Date.now() });
  }

  /** Server time as this device estimates it. */
  serverNow(): number {
    return Date.now() + this.offset;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<ClientState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  private request<T>(event: string, payload: object): Promise<Ack<T>> {
    return new Promise((resolve) => this.socket.emit(event, payload, resolve));
  }

  private async rejoin(s: Saved) {
    const r = await this.request<SessionInfo>('join', { roomCode: s.roomCode, name: s.name, token: s.token, device: this.device });
    if (r.ok) return this.set({ restoring: false });
    this.leave(r.code === 'kicked' ? r.message : r.code === 'no-room' ? 'That room has ended' : null);
  }

  async createRoom(name: string, householdName: string): Promise<string | null> {
    const r = await this.request<SessionInfo>('createRoom', { name, householdName, device: this.device });
    if (!r.ok) return r.message;
    this.saved = { roomCode: r.data.roomCode, token: r.data.token, name };
    save(this.saved);
    return null;
  }

  async join(
    roomCode: string,
    name: string,
    household: { householdId: string } | { householdName: string },
  ): Promise<string | null> {
    const r = await this.request<SessionInfo>('join', { roomCode, name, ...household, device: this.device });
    if (!r.ok) return r.message;
    this.saved = { roomCode: r.data.roomCode, token: r.data.token, name };
    save(this.saved);
    return null;
  }

  async roomInfo(roomCode: string): Promise<RoomInfo | string> {
    const r = await this.request<RoomInfo>('roomInfo', { roomCode });
    return r.ok ? r.data : r.message;
  }

  send<K extends keyof ClientMessages>(event: K, payload: ClientMessages[K]): Promise<string | null> {
    return this.request(event, payload).then((r) => (r.ok ? null : r.message));
  }

  /** Forget this seat and go back to the home screen. */
  leave(notice: string | null = null) {
    this.saved = null;
    save(null);
    this.set({ view: null, restoring: false, notice });
    void this.audio.disconnect();
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    // Reconnect so the server sees us as gone from the old room.
    this.socket.disconnect().connect();
  }
}

export const client = new GameClient();

export function useAudio(): AudioState {
  return useSyncExternalStore(client.audio.subscribe, client.audio.getState);
}

export function useClient(): ClientState {
  return useSyncExternalStore(client.subscribe, client.getState);
}
