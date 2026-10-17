import { z } from 'zod';
import { LIMITS } from './config.js';

const name = z.string().trim().min(1).max(LIMITS.maxNameLength);
const roomCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}$/);
const id = z.string().min(1).max(64);
const token = z.string().min(8).max(128);

export const createRoomSchema = z.object({ name, householdName: name });

export const joinSchema = z
  .object({
    roomCode,
    name,
    householdId: id.optional(),
    householdName: name.optional(),
    token: token.optional(),
  })
  .refine((m) => m.token || m.householdId || m.householdName, {
    message: 'Pick or create a household',
  });

export const roomInfoSchema = z.object({ roomCode });

export const setConfigSchema = z.object({
  wordsPerRound: z.number().int().min(1).max(LIMITS.maxWordsPerRound).optional(),
  packIds: z.array(id).min(1).max(20).optional(),
});

export const startGameSchema = z.object({}).strict();
export const grabSchema = z.object({ wordId: id });
export const micSchema = z.object({ attemptId: id });
export const voteSchema = z.object({ attemptId: id, vote: z.enum(['boo', 'hurray']) });
export const readySchema = z.object({}).strict();

export const hostActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('skipWord') }),
  z.object({ action: z.literal('forceNext') }),
  z.object({ action: z.literal('newGame') }),
  z.object({ action: z.literal('kick'), playerId: id }),
]);

export const clockPingSchema = z.object({ clientTime: z.number() });

/** Every client-to-server message, by Socket.IO event name. */
export const clientMessages = {
  createRoom: createRoomSchema,
  join: joinSchema,
  roomInfo: roomInfoSchema,
  setConfig: setConfigSchema,
  startGame: startGameSchema,
  grab: grabSchema,
  micPress: micSchema,
  micRelease: micSchema,
  vote: voteSchema,
  hostAction: hostActionSchema,
  clockPing: clockPingSchema,
} as const;

export type ClientMessages = {
  [K in keyof typeof clientMessages]: z.infer<(typeof clientMessages)[K]>;
};

/** Reply to createRoom and join. */
export interface SessionInfo {
  roomCode: string;
  playerId: string;
  /** Saved in local storage; rejoining with it restores the seat. */
  token: string;
}

export interface RoomInfo {
  roomCode: string;
  phase: string;
  households: { id: string; name: string }[];
}

export type Ack<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; code: string; message: string };

export interface ServerEvents {
  view: (view: import('./types.js').View) => void;
  clockPong: (m: { clientTime: number; serverTime: number }) => void;
  error: (m: { code: string; message: string }) => void;
}
