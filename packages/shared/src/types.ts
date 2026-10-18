import type { GameConfig } from './config.js';
import type { PackKind, ThemeColor, ThemeFont } from './packs.js';

export type Vote = 'boo' | 'hurray';
export type Phase = 'lobby' | 'word' | 'intermission' | 'final';
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

export type IntermissionStage = 'question' | 'reveal' | 'leaderboard';

/** The trivia question between rounds. The right answer stays out of the view until the reveal. */
export interface TriviaView {
  id: string;
  question: string;
  choices: string[];
  /** Who has answered, never what. */
  answered: string[];
  eligible: number;
  /** This device's own answer. */
  mine: number | null;
  /** Reveal only. */
  correct: number | null;
  /** Reveal only: every answer, so the room can see who got it. */
  picks: { playerId: string; choice: number }[] | null;
  source: string | null;
}

export interface IntermissionView {
  stage: IntermissionStage;
  trivia: TriviaView | null;
  /** Server timestamp at which the reveal ends. */
  revealUntil: number | null;
  /** Leaderboard only: server timestamp before which the next round cannot start. */
  minUntil: number | null;
  /** Players who have tapped Ready. */
  ready: string[];
}

/** A final award. Ties share it; an award nobody earned is left out. */
export interface AwardView {
  kind: 'hater' | 'generous' | 'stolen';
  playerIds: string[];
  /** Overruled boos, hurrays cast, or times stolen from. */
  value: number;
}

export interface PackInfo {
  id: string;
  name: string;
  kind: PackKind;
  /** Words or questions, after dropping repeats. For a theme, the words it adds. */
  count: number;
  /** Themes only: the questions it adds. */
  questions?: number;
  /** Uploaded to this room rather than built in. */
  uploaded: boolean;
}

/** What a device needs to join the room's audio. */
export interface MediaInfo {
  /** LiveKit URL the browser connects to. */
  url: string;
  token: string;
  /** This device is its household's speaker: it plays remote singers. */
  playRemote: boolean;
}

export type CueName = 'grab' | 'boo' | 'point' | 'steal' | 'round' | 'final';

/** The look and sounds every device applies, resolved to URLs the server hands out. */
export interface ThemeView {
  id: string;
  name: string;
  colors: Partial<Record<ThemeColor, string>>;
  font: ThemeFont;
  background: string | null;
  sounds: Partial<Record<CueName, string>>;
}

export interface DeviceView {
  id: string;
  /** The phone's player; null for a TV main screen. */
  playerId: string | null;
  screen: boolean;
  householdId: string;
  connected: boolean;
  /** The one device in its household that plays remote audio. */
  speaker: boolean;
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
    /** True on a TV main screen, which has no player and no controls. */
    screen: boolean;
    playerId: string;
    isHost: boolean;
    /** Tapped Ready in this intermission. */
    ready: boolean;
    /** Answered the trivia question in this intermission. */
    answered: boolean;
    /** This device's own vote on the current attempt. */
    vote: Vote | null;
    canGrab: boolean;
  };
  /** 1-based round, and the word within it. During an intermission, the round that just ended. */
  roundNumber: number;
  totalRounds: number;
  wordInRound: number;
  wordNumber: number;
  totalWords: number;
  intermission: IntermissionView | null;
  /** Final results only. */
  awards: AwardView[];
  word: WordView | null;
  /** Devices that can play audio, filled in by the server. */
  devices: DeviceView[];
  /** The theme the host picked, filled in by the server. */
  theme: ThemeView | null;
  /** Lobby only, filled in by the server. */
  packs?: PackInfo[];
  /** Lobby only, filled in by the server: why Start is blocked, if it is. */
  startBlocked?: string | null;
}
