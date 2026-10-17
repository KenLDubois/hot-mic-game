import {
  ConnectionState,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from 'livekit-client';
import type { MediaInfo } from '@hot-mic/shared';

export type MicPermission = 'unknown' | 'granted' | 'denied' | 'unavailable';

export interface AudioState {
  /** The server has audio set up: it sent this device a media token. */
  enabled: boolean;
  /** Connected to the media server. */
  connected: boolean;
  /** This device is its household's speaker. */
  playRemote: boolean;
  /** The browser is blocking playback until the next tap. */
  playbackBlocked: boolean;
  mic: MicPermission;
}

/** Echo cancellation stays on as a backup; noise suppression chops up singing, so it is off. */
export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: true,
};

/**
 * This device's side of the room's audio: join the media server, play the singer if this is the
 * household's speaker, and publish the microphone while this player is singing.
 */
export class AudioSession {
  state: AudioState = {
    enabled: false,
    connected: false,
    playRemote: false,
    playbackBlocked: false,
    mic: typeof navigator !== 'undefined' && !!navigator.mediaDevices ? 'unknown' : 'unavailable',
  };
  /** Called once the device is in the media room, so the server can send its permissions. */
  onConnected: () => void = () => {};

  private listeners = new Set<() => void>();
  private room: Room | null = null;
  private token: string | null = null;
  private playRemote = false;
  private elements = new Map<string, HTMLMediaElement>();
  private ctx: AudioContext | null = null;
  private singing = false;
  private held = false;
  private chain: Promise<void> = Promise.resolve();
  private analyser: { node: AnalyserNode; source: MediaStreamAudioSourceNode; data: Uint8Array<ArrayBuffer> } | null = null;

  constructor() {
    void this.watchPermission();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<AudioState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  /** Mobile browsers play no sound until the user has tapped something; call this from a tap. */
  unlock() {
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
      const buffer = this.ctx.createBuffer(1, 1, 22050);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      source.start(0);
    } catch {
      // No Web Audio: the media element path may still work.
    }
    void this.room?.startAudio().catch(() => {});
  }

  /** The shared Web Audio context, once a tap has unlocked it. Null while the browser still blocks sound. */
  runningContext(): AudioContext | null {
    return this.ctx && this.ctx.state === 'running' ? this.ctx : null;
  }

  /** Ask for the microphone, then let go of it again. Used by the lobby's mic check. */
  async requestMic(): Promise<MediaStream | null> {
    if (!navigator.mediaDevices) {
      this.set({ mic: 'unavailable' });
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      this.set({ mic: 'granted' });
      return stream;
    } catch (e) {
      this.set({ mic: (e as DOMException).name === 'NotFoundError' ? 'unavailable' : 'denied' });
      return null;
    }
  }

  private async watchPermission() {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      const apply = () => {
        if (status.state === 'granted') this.set({ mic: 'granted' });
        else if (status.state === 'denied') this.set({ mic: 'denied' });
      };
      apply();
      status.onchange = apply;
    } catch {
      // Safari and others don't report it; we find out when we ask.
    }
  }

  /** Join (or re-join) the media room with what the server just sent. */
  async connect(info: MediaInfo) {
    this.playRemote = info.playRemote;
    this.set({ enabled: true, playRemote: info.playRemote });
    this.syncPlayback();
    if (this.room && this.token === info.token) return;
    this.token = info.token;
    await this.disconnectRoom();

    const room = new Room({
      audioCaptureDefaults: MIC_CONSTRAINTS,
      publishDefaults: { dtx: false, red: true },
    });
    this.room = room;
    room
      .on(RoomEvent.TrackSubscribed, (track) => this.attach(track))
      .on(RoomEvent.TrackUnsubscribed, (track) => this.detach(track))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => this.set({ playbackBlocked: !room.canPlaybackAudio }))
      .on(RoomEvent.LocalTrackUnpublished, () => this.dropAnalyser())
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
        if (participant === room.localParticipant) this.queuePublishSync();
      })
      .on(RoomEvent.Disconnected, () => {
        if (this.room === room) this.set({ connected: false });
      })
      .on(RoomEvent.Connected, () => {
        this.set({ connected: true });
        this.onConnected();
      });
    try {
      await room.connect(info.url, info.token, { autoSubscribe: true });
      this.set({ playbackBlocked: !room.canPlaybackAudio });
      this.queuePublishSync();
    } catch {
      if (this.room === room) this.set({ connected: false });
    }
  }

  async disconnect() {
    this.token = null;
    this.singing = false;
    this.playRemote = false;
    await this.disconnectRoom();
    this.set({ enabled: false, connected: false, playRemote: false, playbackBlocked: false });
  }

  private async disconnectRoom() {
    const room = this.room;
    this.room = null;
    this.dropAnalyser();
    for (const el of this.elements.values()) el.remove();
    this.elements.clear();
    if (room) await room.disconnect(true).catch(() => {});
  }

  /** Let the browser start blocked playback; needs a tap. */
  async enablePlayback() {
    this.unlock();
    await this.room?.startAudio().catch(() => {});
    this.set({ playbackBlocked: !(this.room?.canPlaybackAudio ?? true) });
  }

  // --- Listening ---

  private attach(track: RemoteTrack) {
    if (track.kind !== Track.Kind.Audio || !this.playRemote) return;
    this.elements.get(track.sid ?? '')?.remove();
    const el = track.attach();
    el.style.display = 'none';
    document.body.appendChild(el);
    this.elements.set(track.sid ?? el.id, el);
  }

  private detach(track: RemoteTrack) {
    track.detach().forEach((el) => el.remove());
    this.elements.delete(track.sid ?? '');
  }

  /** Start or stop playing every audio track we are subscribed to, as the speaker role changes. */
  private syncPlayback() {
    const room = this.room;
    if (!room) return;
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        if (!pub.track) continue;
        if (this.playRemote) this.attach(pub.track);
        else this.detach(pub.track);
      }
    }
  }

  // --- Singing ---

  /**
   * Whether this player holds the mic right now, and whether the button is down. The microphone
   * is captured and published while singing, and live only while the button is held.
   */
  setSinging(singing: boolean, held: boolean) {
    this.singing = singing;
    this.held = held;
    this.queuePublishSync();
  }

  private queuePublishSync() {
    this.chain = this.chain.then(() => this.syncPublish()).catch(() => {});
  }

  private async syncPublish() {
    const room = this.room;
    if (!room || room.state !== ConnectionState.Connected) return;
    const lp = room.localParticipant;
    const pub = lp.getTrackPublication(Track.Source.Microphone);
    if (!this.singing) {
      if (pub) await lp.setMicrophoneEnabled(false);
      this.dropAnalyser();
      return;
    }
    if (!lp.permissions?.canPublish) return; // the server hasn't allowed it yet; the permissions event retries
    if (!pub) {
      try {
        await lp.setMicrophoneEnabled(true, MIC_CONSTRAINTS);
        this.set({ mic: 'granted' });
      } catch (e) {
        this.set({ mic: (e as DOMException).name === 'NotFoundError' ? 'unavailable' : 'denied' });
        return;
      }
    }
    const track = lp.getTrackPublication(Track.Source.Microphone)?.track;
    if (!track) return;
    this.watchLocal(track as LocalAudioTrack);
    if (this.held && track.isMuted) await track.unmute();
    else if (!this.held && !track.isMuted) await track.mute();
  }

  // --- Levels, for the waveform ---

  private watchLocal(track: LocalAudioTrack) {
    if (this.analyser) return;
    try {
      this.ctx ??= new AudioContext();
      const source = this.ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
      const node = this.ctx.createAnalyser();
      node.fftSize = 256;
      source.connect(node);
      this.analyser = { node, source, data: new Uint8Array(node.fftSize) };
    } catch {
      // Falls back to the level LiveKit reports.
    }
  }

  private dropAnalyser() {
    this.analyser?.source.disconnect();
    this.analyser = null;
  }

  /** The singer's current loudness from 0 to 1: the local mic for the singer, LiveKit's report for everyone else. */
  level(isSinger: boolean): number {
    const room = this.room;
    if (isSinger && this.analyser) {
      const { node, data } = this.analyser;
      node.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      return Math.min(1, peak / 64);
    }
    if (!room) return 0;
    if (isSinger) return room.localParticipant.audioLevel;
    let loudest = 0;
    for (const p of room.remoteParticipants.values()) loudest = Math.max(loudest, p.audioLevel);
    return Math.min(1, loudest * 1.5);
  }
}
