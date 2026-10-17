/** Every duration and point value in the game. Times are milliseconds. */
export interface Rules {
  /** Grab timer when a word first opens. */
  grabMs: number;
  /** Grab timer after a boo. */
  stealGrabMs: number;
  /** Time after a release in which pressing again resumes the song. */
  graceMs: number;
  /** Song length cap, from the first press. */
  songCapMs: number;
  /** Voting window after the singer finishes. */
  voteMs: number;
  /** "Mic opens in 3… 2… 1" countdown after a boo. */
  stealCountdownMs: number;
  /** How long the vote result is shown. Tune in playtesting. */
  resultHoldMs: number;
  /** How long a word's outcome is shown. Tune in playtesting. */
  doneHoldMs: number;
  /** How long the host can be away before host controls pass on. */
  hostTransferMs: number;
  /** Points for a song that survives the vote. */
  songPoints: number;
  /** Fewest connected players needed to start. */
  minPlayers: number;
}

export const DEFAULT_RULES: Rules = {
  grabMs: 20_000,
  stealGrabMs: 10_000,
  graceMs: 2_000,
  songCapMs: 45_000,
  voteMs: 10_000,
  stealCountdownMs: 3_000,
  resultHoldMs: 6_000,
  doneHoldMs: 4_000,
  hostTransferMs: 30_000,
  songPoints: 2,
  minPlayers: 2,
};

/** What the host picks in the lobby. */
export interface GameConfig {
  /** Fixed at 1 until Milestone 4 adds intermissions. */
  rounds: number;
  wordsPerRound: number;
  packIds: string[];
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  rounds: 1,
  wordsPerRound: 5,
  packIds: ['starter'],
};

export const LIMITS = {
  maxWordsPerRound: 50,
  maxNameLength: 24,
  /** Safety guard for a public-facing server, not a design target (4 to 12). */
  maxPlayers: 24,
  /** Rooms with nobody connected are discarded after this long. */
  roomDiscardMs: 10 * 60_000,
};
