/**
 * Everything the game server needs from the media server. Milestone 1 plays
 * no audio, so the adapter does nothing; Milestone 2 swaps in LiveKit without
 * touching the engine.
 */
export interface MediaAdapter {
  /** Let only this player send audio in the room. */
  grantSend(roomCode: string, playerId: string, attemptId: string): void;
  /** Take the send permission back. */
  revokeSend(roomCode: string, playerId: string, attemptId: string): void;
  /** The room is gone. */
  closeRoom(roomCode: string): void;
}

export class NoopMediaAdapter implements MediaAdapter {
  grantSend() {}
  revokeSend() {}
  closeRoom() {}
}
