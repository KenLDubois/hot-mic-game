import type { GameConfig } from './config.js';

export type Vote = 'boo' | 'hurray';
export type Phase = 'lobby' | 'word' | 'final';
export type WordStatus = 'open' | 'singing' | 'voting' | 'result' | 'steal' | 'done';

export interface PlayerStats {
  boosCast: number;
  hurraysCast: number;
  /** Boos that lost the vote. */
  overruledBoos: number;
  timesBooed: number;
  /** Booed on a word that someone else then scored. */
  stolenFrom: number;
}

export interface PlayerView {
  id: string;
  name: string;
  householdId: string;
  connected: boolean;
  kicked: boolean;
  isHost: boolean;
  score: number;
  stats: PlayerStats;
}

export interface HouseholdView {
  id: string;
  name: string;
}

export interface ResultView {
  booed: boolean;
  boos: number;
  hurrays: number;
  votes: { playerId: string; vote: Vote }[];
  pointsAwarded: number;
}

export interface OutcomeView {
  kind: 'scored' | 'skipped' | 'noPoint';
  singerId?: string;
  points?: number;
}

export interface WordView {
  id: string;
  text: string;
  status: WordStatus;
  /** Server timestamp at which the current status ends, if it has a timer. */
  deadline: number | null;
  isSteal: boolean;
  lockedOut: string[];
  singerId: string | null;
  attemptId: string | null;
  /** Whether the singer is holding the mic button. */
  held: boolean;
  /** Server timestamp at which the grace ring runs out, after a release. */
  graceDeadline: number | null;
  /** Server timestamp at which the 45 s song cap hits, while singing. */
  capDeadline: number | null;
  /** Votes cast so far; never which way, until the result. */
  voteCount: number;
  eligibleVoters: number;
  result: ResultView | null;
  outcome: OutcomeView | null;
}

export interface PackInfo {
  id: string;
  name: string;
  wordCount: number;
}

export interface View {
  version: number;
  serverTime: number;
  roomCode: string;
  phase: Phase;
  config: GameConfig;
  hostId: string;
  players: PlayerView[];
  households: HouseholdView[];
  you: {
    playerId: string;
    isHost: boolean;
    /** This device's own vote on the current attempt. */
    vote: Vote | null;
    canGrab: boolean;
  };
  wordNumber: number;
  totalWords: number;
  word: WordView | null;
  /** Lobby only, filled in by the server. */
  packs?: PackInfo[];
  /** Lobby only, filled in by the server: why Start is blocked, if it is. */
  startBlocked?: string | null;
}
