/** What a device may do in the room's audio. */
export interface DevicePermissions {
  /** Send audio: only the singer, only while singing. */
  canPublish: boolean;
  /** Receive audio: only a household's speaker device, never in the singer's own household. */
  canSubscribe: boolean;
}

export interface ConnectInfo {
  /** Where the browser connects. */
  url: string;
  token: string;
}

/**
 * Everything the game server needs from the media server. The engine never
 * touches this; the room works out who may send and who may hear, and the
 * adapter makes the media server agree.
 */
export interface MediaAdapter {
  /** Whether audio is set up at all. Without it the game runs on a video call. */
  readonly enabled: boolean;
  /** A token for this device to join the room's audio with the given permissions. */
  connectInfo(roomCode: string, deviceId: string, perms: DevicePermissions): Promise<ConnectInfo | null>;
  /** Change a connected device's permissions. Rejects if it is not connected yet. */
  setPermissions(roomCode: string, deviceId: string, perms: DevicePermissions): Promise<void>;
  /** The room is gone. */
  closeRoom(roomCode: string): Promise<void>;
}

export class NoopMediaAdapter implements MediaAdapter {
  readonly enabled = false;
  async connectInfo() {
    return null;
  }
  async setPermissions() {}
  async closeRoom() {}
}
