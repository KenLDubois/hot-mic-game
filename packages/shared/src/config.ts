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
  /** Shortest intermission, so the leaderboard can be read even when everyone is ready at once. */
  intermissionMinMs: number;
  /** How long the correct trivia answer is shown before the leaderboard. */
  triviaRevealMs: number;
  /** Points for a correct trivia answer. */
  triviaPoints: number;
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
  intermissionMinMs: 20_000,
  triviaRevealMs: 8_000,
  triviaPoints: 1,
  doneHoldMs: 4_000,
  hostTransferMs: 30_000,
  songPoints: 2,
  minPlayers: 2,
};

/** What the host picks in the lobby. */
export interface GameConfig {
  rounds: number;
  wordsPerRound: number;
  /** Word packs. */
  packIds: string[];
  /** One music question for everyone between rounds. */
  trivia: boolean;
  triviaPackIds: string[];
  /** A theme pack's id: its look, sounds, words and questions. Null for the plain game. */
  themeId: string | null;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  rounds: 1,
  wordsPerRound: 5,
  packIds: ['starter'],
  trivia: false,
  triviaPackIds: ['music-trivia'],
  themeId: null,
};

export const LIMITS = {
  maxRounds: 10,
  maxUploadedPacks: 10,
  maxWordsPerRound: 50,
  maxNameLength: 24,
  /** Safety guard for a public-facing server, not a design target (4 to 12). */
  maxPlayers: 24,
  /** Rooms with nobody connected are discarded after this long. */
  roomDiscardMs: 10 * 60_000,
};
