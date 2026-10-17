import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import type { ConnectInfo, DevicePermissions, MediaAdapter } from './media.js';

export interface LiveKitOptions {
  /** URL the browsers connect to, e.g. wss://hotmic.example.com/livekit */
  publicUrl: string;
  /** URL the game server uses for the admin API, e.g. http://livekit:7880 */
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
  /** How long a device's token stays valid, in seconds. */
  tokenTtl?: number;
}

/** The subset of RoomServiceClient the adapter uses, so tests can fake it. */
export interface RoomApi {
  updateParticipant(room: string, identity: string, metadata?: string, permission?: object): Promise<unknown>;
  deleteRoom(room: string): Promise<void>;
}

export class LiveKitMediaAdapter implements MediaAdapter {
  readonly enabled = true;
  private api: RoomApi;

  constructor(
    private opts: LiveKitOptions,
    api?: RoomApi,
  ) {
    this.api = api ?? new RoomServiceClient(opts.apiUrl, opts.apiKey, opts.apiSecret);
  }

  async connectInfo(roomCode: string, deviceId: string, perms: DevicePermissions): Promise<ConnectInfo> {
    const token = new AccessToken(this.opts.apiKey, this.opts.apiSecret, {
      identity: deviceId,
      ttl: this.opts.tokenTtl ?? 6 * 3600,
    });
    token.addGrant({
      room: roomCode,
      roomJoin: true,
      canPublish: perms.canPublish,
      canSubscribe: perms.canSubscribe,
      canPublishData: false,
    });
    return { url: this.opts.publicUrl, token: await token.toJwt() };
  }

  async setPermissions(roomCode: string, deviceId: string, perms: DevicePermissions): Promise<void> {
    await this.api.updateParticipant(roomCode, deviceId, undefined, {
      canPublish: perms.canPublish,
      canSubscribe: perms.canSubscribe,
      canPublishData: false,
    });
  }

  async closeRoom(roomCode: string): Promise<void> {
    await this.api.deleteRoom(roomCode).catch(() => {});
  }
}

/** Builds the LiveKit adapter from the environment, or null if audio isn't configured. */
export function liveKitFromEnv(env: NodeJS.ProcessEnv): LiveKitMediaAdapter | null {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return null;
  return new LiveKitMediaAdapter({
    publicUrl: LIVEKIT_URL,
    apiUrl: env.LIVEKIT_API_URL ?? LIVEKIT_URL.replace(/^ws/, 'http'),
    apiKey: LIVEKIT_API_KEY,
    apiSecret: LIVEKIT_API_SECRET,
  });
}
