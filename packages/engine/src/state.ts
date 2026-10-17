import type {
  GameConfig,
  OutcomeView,
  PlayerStats,
  ResultView,
  Rules,
  Vote,
  WordStatus,
} from '@hot-mic/shared';

export interface Player {
  id: string;
  name: string;
  householdId: string;
  connected: boolean;
  kicked: boolean;
  connectedAt: number;
  score: number;
  stats: PlayerStats;
}

export interface Household {
  id: string;
  name: string;
}

export interface Attempt {
  id: string;
  singerId: string;
  /** Deadline for the 45 s cap, counted from the first press. */
  capAt: number;
  held: boolean;
  /** Set while the singer has released and the grace ring is draining. */
  graceAt: number | null;
  votes: Record<string, Vote>;
}

export interface WordState {
  id: string;
  index: number;
  text: string;
  status: WordStatus;
  /** End of the current status, for the statuses that are not singing. */
  deadline: number | null;
  isSteal: boolean;
  lockedOut: string[];
  /** Joined after this word started, so they sit it out. */
  sitOut: string[];
  everGrabbed: boolean;
  /** Singers booed on this word, for the "Most Stolen From" stat. */
  booedSingers: string[];
  attempt: Attempt | null;
  result: ResultView | null;
  outcome: OutcomeView | null;
}

export interface GameState {
  version: number;
  rules: Rules;
  phase: 'lobby' | 'word' | 'intermission' | 'final';
  config: GameConfig;
  hostId: string | null;
  /** When the host went away, if they are away. */
  hostAwayAt: number | null;
  players: Record<string, Player>;
  /** Join order, which also gives the longest-connected tiebreak. */
  playerOrder: string[];
  households: Household[];
  words: string[];
  wordIndex: number;
  word: WordState | null;
  /** 0-based round in play; during an intermission, the one that just ended. */
  roundIndex: number;
  intermission: { minUntil: number; ready: string[] } | null;
  counters: { household: number; attempt: number };
}

export type HouseholdChoice = { kind: 'existing'; id: string } | { kind: 'new'; name: string };

export type HostActionName = 'skipWord' | 'forceNext' | 'newGame' | 'kick';

export type GameEvent =
  | { type: 'playerJoined'; playerId: string; name: string; household: HouseholdChoice }
  | { type: 'playerConnected'; playerId: string }
  | { type: 'playerDisconnected'; playerId: string }
  | { type: 'setConfig'; playerId: string; rounds?: number; wordsPerRound?: number; packIds?: string[] }
  | { type: 'startGame'; playerId: string; words: string[] }
  | { type: 'grab'; playerId: string; wordId: string }
  | { type: 'micPress'; playerId: string; attemptId: string }
  | { type: 'micRelease'; playerId: string; attemptId: string }
  | { type: 'vote'; playerId: string; attemptId: string; vote: Vote }
  | { type: 'ready'; playerId: string }
  | { type: 'hostAction'; playerId: string; action: HostActionName; targetId?: string }
  | { type: 'tick' };

export type Effect =
  /** The singer may now send audio. */
  | { type: 'grantAudio'; playerId: string; attemptId: string }
  | { type: 'revokeAudio'; playerId: string; attemptId: string }
  | { type: 'cue'; name: 'grab' | 'boo' | 'point' | 'steal' | 'round' | 'final' }
  | { type: 'error'; playerId: string; code: string; message: string }
  /** The server should drop this player's sockets. */
  | { type: 'kicked'; playerId: string };

export interface StepResult {
  state: GameState;
  effects: Effect[];
}
