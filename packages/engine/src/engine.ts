import { DEFAULT_GAME_CONFIG, DEFAULT_RULES, LIMITS, type Rules } from '@hot-mic/shared';
import type {
  Attempt,
  Effect,
  GameEvent,
  GameState,
  StepResult,
  WordState,
} from './state.js';

const emptyStats = () => ({
  boosCast: 0,
  hurraysCast: 0,
  overruledBoos: 0,
  timesBooed: 0,
  stolenFrom: 0,
});

export function createGame(rules: Partial<Rules> = {}): GameState {
  return {
    version: 0,
    rules: { ...DEFAULT_RULES, ...rules },
    phase: 'lobby',
    config: { ...DEFAULT_GAME_CONFIG, packIds: [...DEFAULT_GAME_CONFIG.packIds] },
    hostId: null,
    hostAwayAt: null,
    players: {},
    playerOrder: [],
    households: [],
    words: [],
    questions: [],
    wordIndex: 0,
    word: null,
    roundIndex: 0,
    intermission: null,
    counters: { household: 0, attempt: 0 },
  };
}

/**
 * The whole game as one pure function. Timers are deadlines stored in state;
 * the caller feeds a `tick` at `nextDeadline(state)` and the engine does the rest.
 */
export function step(prev: GameState, event: GameEvent, now: number): StepResult {
  const state = structuredClone(prev);
  const fx: Effect[] = [];
  // Bring the clock up to `now` first so an event never sees an expired timer.
  settle(state, now, fx);
  handle(state, event, now, fx);
  settle(state, now, fx);
  state.version += 1;
  return { state, effects: fx };
}

/** The earliest moment the engine needs a `tick`, or null if it is waiting on players. */
export function nextDeadline(s: GameState): number | null {
  const times: number[] = [];
  const transfer = hostTransferAt(s);
  if (transfer !== null) times.push(transfer);
  const w = s.word;
  if (s.phase === 'word' && w) {
    if (w.status === 'singing' && w.attempt) times.push(singingEnd(w.attempt));
    else if (w.deadline !== null) times.push(w.deadline);
  }
  // Otherwise the intermission waits on players; only the minimum time is a deadline.
  const im = s.phase === 'intermission' ? s.intermission : null;
  if (im?.stage === 'reveal' && im.revealUntil !== null) times.push(im.revealUntil);
  if (im?.stage === 'leaderboard' && im.minUntil !== null && everyoneReady(s)) times.push(im.minUntil);
  return times.length ? Math.min(...times) : null;
}

// ---------------------------------------------------------------- queries

export function canGrab(s: GameState, w: WordState, playerId: string): boolean {
  const p = s.players[playerId];
  return (
    !!p &&
    p.connected &&
    !p.kicked &&
    !w.lockedOut.includes(playerId) &&
    !w.sitOut.includes(playerId)
  );
}

export function eligibleVoters(s: GameState, w: WordState): string[] {
  const singer = w.attempt?.singerId;
  return s.playerOrder.filter((id) => {
    const p = s.players[id]!;
    return p.connected && !p.kicked && id !== singer;
  });
}

function someoneCanGrab(s: GameState, w: WordState): boolean {
  return s.playerOrder.some((id) => canGrab(s, w, id));
}

function everyoneReady(s: GameState): boolean {
  const here = activePlayers(s).filter((p) => p.connected);
  return here.length > 0 && here.every((p) => s.intermission?.ready.includes(p.id));
}

function everyoneAnswered(s: GameState): boolean {
  const here = activePlayers(s).filter((p) => p.connected);
  const t = s.intermission?.trivia;
  return !!t && here.length > 0 && here.every((p) => t.answers[p.id] !== undefined);
}

function activePlayers(s: GameState) {
  return s.playerOrder.map((id) => s.players[id]!).filter((p) => !p.kicked);
}

function singingEnd(a: Attempt): number {
  return a.graceAt === null ? a.capAt : Math.min(a.capAt, a.graceAt);
}

function hostCandidate(s: GameState) {
  const candidates = activePlayers(s).filter((p) => p.connected && p.id !== s.hostId);
  // Array.sort is stable, so ties fall back to join order.
  candidates.sort((a, b) => a.connectedAt - b.connectedAt);
  return candidates[0] ?? null;
}

function hostTransferAt(s: GameState): number | null {
  if (s.hostAwayAt === null || !hostCandidate(s)) return null;
  return s.hostAwayAt + s.rules.hostTransferMs;
}

// --------------------------------------------------------------- handlers

function reject(fx: Effect[], playerId: string, code: string, message: string) {
  fx.push({ type: 'error', playerId, code, message });
}

function handle(s: GameState, e: GameEvent, now: number, fx: Effect[]) {
  switch (e.type) {
    case 'playerJoined':
      return onJoined(s, e, now, fx);
    case 'playerConnected': {
      const p = s.players[e.playerId];
      if (!p || p.kicked) return;
      p.connected = true;
      p.connectedAt = now;
      if (s.hostId === p.id) s.hostAwayAt = null;
      return;
    }
    case 'playerDisconnected': {
      const p = s.players[e.playerId];
      if (!p) return;
      p.connected = false;
      if (s.hostId === p.id) s.hostAwayAt = now;
      // A disconnected singer counts as a release, so the grace period applies.
      const a = s.word?.status === 'singing' ? s.word.attempt : null;
      if (a && a.singerId === p.id && a.held) release(s, a, now);
      return;
    }
    case 'setConfig':
      return onSetConfig(s, e, fx);
    case 'startGame':
      return onStart(s, e, now, fx);
    case 'grab': {
      const w = s.word;
      if (s.phase !== 'word' || !w || w.status !== 'open' || w.id !== e.wordId) return;
      if (!canGrab(s, w, e.playerId)) return;
      startSinging(s, w, e.playerId, now, fx);
      return;
    }
    case 'micPress': {
      const a = liveAttempt(s, e.playerId, e.attemptId);
      if (!a || a.held) return;
      a.held = true;
      a.graceAt = null;
      return;
    }
    case 'micRelease': {
      const a = liveAttempt(s, e.playerId, e.attemptId);
      if (!a || !a.held) return;
      release(s, a, now);
      return;
    }
    case 'vote': {
      const w = s.word;
      const a = w?.attempt;
      if (!w || !a || a.id !== e.attemptId) return;
      if (w.status !== 'singing' && w.status !== 'voting') return;
      const p = s.players[e.playerId];
      if (!p || p.kicked || e.playerId === a.singerId) return;
      a.votes[e.playerId] = e.vote;
      return;
    }
    case 'ready': {
      const p = s.players[e.playerId];
      if (s.phase !== 'intermission' || s.intermission?.stage !== 'leaderboard' || !p || p.kicked) return;
      if (!s.intermission.ready.includes(p.id)) s.intermission.ready.push(p.id);
      return;
    }
    case 'triviaAnswer': {
      const t = s.phase === 'intermission' && s.intermission?.stage === 'question' ? s.intermission.trivia : null;
      const p = s.players[e.playerId];
      if (!t || !p || p.kicked || t.id !== e.questionId) return;
      // Answers lock as they are submitted.
      if (t.answers[p.id] !== undefined) return;
      if (!Number.isInteger(e.choice) || e.choice < 0 || e.choice >= t.choices.length) return;
      t.answers[p.id] = e.choice;
      return;
    }
    case 'hostAction':
      return onHostAction(s, e, now, fx);
    case 'tick':
      return; // settle() does the work
  }
}

/** The current attempt, if `playerId` is its singer and the song is still on. */
function liveAttempt(s: GameState, playerId: string, attemptId: string): Attempt | null {
  const w = s.word;
  if (s.phase !== 'word' || !w || w.status !== 'singing') return null;
  const a = w.attempt;
  if (!a || a.id !== attemptId || a.singerId !== playerId) return null;
  return a;
}

function release(s: GameState, a: Attempt, now: number) {
  a.held = false;
  a.graceAt = now + s.rules.graceMs;
}

function onJoined(
  s: GameState,
  e: Extract<GameEvent, { type: 'playerJoined' }>,
  now: number,
  fx: Effect[],
) {
  if (s.players[e.playerId]) return;
  if (s.playerOrder.length >= LIMITS.maxPlayers) {
    return reject(fx, e.playerId, 'room-full', 'This room is full');
  }
  let household;
  if (e.household.kind === 'existing') {
    const id = e.household.id;
    household = s.households.find((h) => h.id === id);
    if (!household) return reject(fx, e.playerId, 'no-household', 'That household does not exist');
  } else {
    const name = e.household.name.trim();
    // Typing the same household name again means the same household.
    household = s.households.find((h) => h.name.toLowerCase() === name.toLowerCase());
    if (!household) {
      household = { id: `h${++s.counters.household}`, name };
      s.households.push(household);
    }
  }

  const base = e.name.trim();
  const taken = new Set(Object.values(s.players).map((p) => p.name.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;

  s.players[e.playerId] = {
    id: e.playerId,
    name,
    householdId: household.id,
    connected: true,
    kicked: false,
    connectedAt: now,
    score: 0,
    stats: emptyStats(),
  };
  s.playerOrder.push(e.playerId);
  if (!s.hostId) s.hostId = e.playerId;
  // Joining mid-word means sitting that word out; they can grab from the next one.
  if (s.phase === 'word' && s.word && s.word.status !== 'done') s.word.sitOut.push(e.playerId);
}

function onSetConfig(
  s: GameState,
  e: Extract<GameEvent, { type: 'setConfig' }>,
  fx: Effect[],
) {
  if (e.playerId !== s.hostId) return reject(fx, e.playerId, 'not-host', 'Only the host can do that');
  if (s.phase !== 'lobby') return reject(fx, e.playerId, 'not-lobby', 'The game has already started');
  if (e.rounds !== undefined) {
    if (!Number.isInteger(e.rounds) || e.rounds < 1 || e.rounds > LIMITS.maxRounds) {
      return reject(fx, e.playerId, 'bad-config', `Pick 1 to ${LIMITS.maxRounds} rounds`);
    }
    s.config.rounds = e.rounds;
  }
  if (e.wordsPerRound !== undefined) {
    if (
      !Number.isInteger(e.wordsPerRound) ||
      e.wordsPerRound < 1 ||
      e.wordsPerRound > LIMITS.maxWordsPerRound
    ) {
      return reject(fx, e.playerId, 'bad-config', `Pick 1 to ${LIMITS.maxWordsPerRound} words`);
    }
    s.config.wordsPerRound = e.wordsPerRound;
  }
  if (e.packIds) s.config.packIds = [...e.packIds];
  if (e.trivia !== undefined) s.config.trivia = e.trivia;
  if (e.triviaPackIds) s.config.triviaPackIds = [...e.triviaPackIds];
}

function onStart(
  s: GameState,
  e: Extract<GameEvent, { type: 'startGame' }>,
  now: number,
  fx: Effect[],
) {
  if (e.playerId !== s.hostId) return reject(fx, e.playerId, 'not-host', 'Only the host can do that');
  if (s.phase !== 'lobby') return reject(fx, e.playerId, 'not-lobby', 'The game has already started');
  const present = activePlayers(s).filter((p) => p.connected).length;
  if (present < s.rules.minPlayers) {
    return reject(fx, e.playerId, 'too-few-players', `Need at least ${s.rules.minPlayers} players`);
  }
  const total = s.config.rounds * s.config.wordsPerRound;
  if (e.words.length < total) {
    return reject(
      fx,
      e.playerId,
      'not-enough-words',
      `The packs are ${total - e.words.length} words short for ${total} words`,
    );
  }
  // One question for each intermission, and none after the last round.
  const needed = s.config.trivia ? s.config.rounds - 1 : 0;
  const questions = e.questions ?? [];
  if (questions.length < needed) {
    return reject(
      fx,
      e.playerId,
      'not-enough-questions',
      `The trivia packs are ${needed - questions.length} questions short for ${needed} questions`,
    );
  }
  s.words = e.words.slice(0, total);
  s.questions = questions.slice(0, needed);
  s.wordIndex = 0;
  s.roundIndex = 0;
  s.intermission = null;
  s.phase = 'word';
  openWord(s, 0, now);
}

function onHostAction(
  s: GameState,
  e: Extract<GameEvent, { type: 'hostAction' }>,
  now: number,
  fx: Effect[],
) {
  if (e.playerId !== s.hostId) return reject(fx, e.playerId, 'not-host', 'Only the host can do that');
  const w = s.word;
  switch (e.action) {
    case 'skipWord': {
      if (s.phase !== 'word' || !w || w.status === 'done') return;
      // Once the vote is in there is nothing left to skip, only a display to cut short.
      if (w.status === 'result') return void (w.deadline = now);
      if (w.status === 'singing' && w.attempt) revoke(w.attempt, fx);
      endWord(s, w, now, 'skipped');
      return;
    }
    case 'revealTrivia': {
      if (s.phase === 'intermission' && s.intermission?.stage === 'question') revealTrivia(s, now);
      return;
    }
    case 'forceNext': {
      if (s.phase === 'intermission') {
        const stage = s.intermission?.stage;
        if (stage === 'question') revealTrivia(s, now);
        else if (stage === 'reveal') startLeaderboard(s, now);
        else startRound(s, now);
        return;
      }
      if (s.phase !== 'word' || !w) return;
      if (w.status === 'result' || w.status === 'steal' || w.status === 'done') w.deadline = now;
      return;
    }
    case 'newGame': {
      if (s.phase !== 'final') return;
      s.phase = 'lobby';
      s.word = null;
      s.words = [];
      s.questions = [];
      s.wordIndex = 0;
      s.roundIndex = 0;
      s.intermission = null;
      for (const p of Object.values(s.players)) {
        p.score = 0;
        p.stats = emptyStats();
      }
      return;
    }
    case 'kick': {
      const target = e.targetId ? s.players[e.targetId] : undefined;
      if (!target || target.kicked) return;
      if (target.id === e.playerId) return reject(fx, e.playerId, 'bad-kick', "You can't kick yourself");
      target.kicked = true;
      target.connected = false;
      fx.push({ type: 'kicked', playerId: target.id });
      const a = w?.status === 'singing' ? w.attempt : null;
      if (w && a && a.singerId === target.id) toVoting(s, w, now, fx);
      return;
    }
  }
}

// ----------------------------------------------------------- word machine

/** The round just ended: the trivia question if there is one, otherwise straight to the leaderboard. */
function startIntermission(s: GameState, at: number) {
  s.phase = 'intermission';
  s.word = null;
  const q = s.config.trivia ? s.questions[s.roundIndex] : undefined;
  s.intermission = { stage: 'leaderboard', trivia: null, revealUntil: null, minUntil: null, ready: [] };
  if (q) {
    s.intermission.stage = 'question';
    s.intermission.trivia = {
      id: `q${s.roundIndex + 1}`,
      question: q.question,
      choices: q.choices,
      answer: q.answer,
      source: q.source ?? null,
      answers: {},
    };
  } else {
    startLeaderboard(s, at);
  }
}

/** Correct answers score, and the room sees what everyone picked. */
function revealTrivia(s: GameState, at: number) {
  const im = s.intermission!;
  const t = im.trivia!;
  for (const [id, choice] of Object.entries(t.answers)) {
    const p = s.players[id];
    if (p && choice === t.answer) p.score += s.rules.triviaPoints;
  }
  im.stage = 'reveal';
  im.revealUntil = at + s.rules.triviaRevealMs;
}

function startLeaderboard(s: GameState, at: number) {
  const im = s.intermission!;
  im.stage = 'leaderboard';
  im.revealUntil = null;
  im.minUntil = at + s.rules.intermissionMinMs;
}

/** The next round's first word opens; the host's override and the ready-up both end up here. */
function startRound(s: GameState, now: number) {
  s.phase = 'word';
  s.intermission = null;
  s.roundIndex += 1;
  openWord(s, s.wordIndex + 1, now);
}

function openWord(s: GameState, index: number, now: number) {
  s.wordIndex = index;
  s.word = {
    id: `w${index + 1}`,
    index,
    text: s.words[index]!,
    status: 'open',
    deadline: now + s.rules.grabMs,
    isSteal: false,
    lockedOut: [],
    sitOut: [],
    everGrabbed: false,
    booedSingers: [],
    attempt: null,
    result: null,
    outcome: null,
  };
}

function startSinging(s: GameState, w: WordState, playerId: string, now: number, fx: Effect[]) {
  w.status = 'singing';
  w.deadline = null;
  w.everGrabbed = true;
  w.result = null;
  w.attempt = {
    id: `a${++s.counters.attempt}`,
    singerId: playerId,
    capAt: now + s.rules.songCapMs,
    // An accepted grab counts as already holding.
    held: true,
    graceAt: null,
    votes: {},
  };
  fx.push({ type: 'grantAudio', playerId, attemptId: w.attempt.id });
  fx.push({ type: 'cue', name: 'grab' });
}

function revoke(a: Attempt, fx: Effect[]) {
  fx.push({ type: 'revokeAudio', playerId: a.singerId, attemptId: a.id });
}

function toVoting(s: GameState, w: WordState, at: number, fx: Effect[]) {
  revoke(w.attempt!, fx);
  w.status = 'voting';
  w.deadline = at + s.rules.voteMs;
}

function toResult(s: GameState, w: WordState, at: number, fx: Effect[]) {
  const a = w.attempt!;
  const votes = Object.entries(a.votes).map(([playerId, vote]) => ({ playerId, vote }));
  const boos = votes.filter((v) => v.vote === 'boo').length;
  const hurrays = votes.length - boos;
  // Boos need a strict majority of votes cast; a tie or no votes means the singer scores.
  const booed = boos > hurrays;
  const singer = s.players[a.singerId]!;

  for (const { playerId, vote } of votes) {
    const p = s.players[playerId];
    if (!p) continue;
    if (vote === 'boo') {
      p.stats.boosCast += 1;
      if (!booed) p.stats.overruledBoos += 1;
    } else {
      p.stats.hurraysCast += 1;
    }
  }

  let pointsAwarded = 0;
  if (booed) {
    singer.stats.timesBooed += 1;
    w.lockedOut.push(singer.id);
    w.booedSingers.push(singer.id);
    fx.push({ type: 'cue', name: 'boo' });
  } else {
    pointsAwarded = s.rules.songPoints;
    singer.score += pointsAwarded;
    fx.push({ type: 'cue', name: 'point' });
  }

  w.result = { booed, boos, hurrays, votes, pointsAwarded };
  w.status = 'result';
  w.deadline = at + s.rules.resultHoldMs;
}

function endWord(
  s: GameState,
  w: WordState,
  at: number,
  kind: 'scored' | 'skipped' | 'noPoint',
) {
  w.status = 'done';
  w.deadline = at + s.rules.doneHoldMs;
  if (kind === 'scored') {
    const singerId = w.attempt!.singerId;
    for (const id of w.booedSingers) s.players[id]!.stats.stolenFrom += 1;
    w.outcome = { kind, singerId, points: w.result!.pointsAwarded };
  } else {
    w.outcome = { kind };
  }
}

/** Run every transition whose time has come. Chained steps use the time they were due. */
function settle(s: GameState, now: number, fx: Effect[]) {
  for (let guard = 0; guard < 1000; guard++) {
    if (!advanceHost(s, now) && !advanceWord(s, now, fx)) return;
  }
  throw new Error('engine did not settle');
}

function advanceHost(s: GameState, now: number): boolean {
  const at = hostTransferAt(s);
  if (at === null || at > now) return false;
  s.hostId = hostCandidate(s)!.id;
  s.hostAwayAt = null;
  return true;
}

function advanceWord(s: GameState, now: number, fx: Effect[]): boolean {
  const im = s.phase === 'intermission' ? s.intermission : null;
  if (im) {
    switch (im.stage) {
      case 'question':
        if (!everyoneAnswered(s)) return false;
        revealTrivia(s, now);
        return true;
      case 'reveal':
        if (im.revealUntil! > now) return false;
        startLeaderboard(s, im.revealUntil!);
        return true;
      case 'leaderboard':
        if (!everyoneReady(s) || im.minUntil! > now) return false;
        startRound(s, now);
        return true;
    }
  }
  const w = s.word;
  if (s.phase !== 'word' || !w) return false;
  const due = w.deadline !== null && w.deadline <= now;

  switch (w.status) {
    case 'open': {
      if (!due) return false;
      endWord(s, w, w.deadline!, w.everGrabbed ? 'noPoint' : 'skipped');
      return true;
    }
    case 'singing': {
      const end = singingEnd(w.attempt!);
      if (end > now) return false;
      toVoting(s, w, end, fx);
      return true;
    }
    case 'voting': {
      const a = w.attempt!;
      if (eligibleVoters(s, w).every((id) => a.votes[id])) {
        toResult(s, w, now, fx);
        return true;
      }
      if (!due) return false;
      toResult(s, w, w.deadline!, fx);
      return true;
    }
    case 'result': {
      if (!due) return false;
      const at = w.deadline!;
      if (!w.result!.booed) endWord(s, w, at, 'scored');
      else if (someoneCanGrab(s, w)) {
        w.status = 'steal';
        w.deadline = at + s.rules.stealCountdownMs;
        fx.push({ type: 'cue', name: 'steal' });
      } else endWord(s, w, at, 'noPoint');
      return true;
    }
    case 'steal': {
      if (!due) return false;
      const at = w.deadline!;
      if (!someoneCanGrab(s, w)) endWord(s, w, at, 'noPoint');
      else {
        w.status = 'open';
        w.isSteal = true;
        w.attempt = null;
        w.result = null;
        w.deadline = at + s.rules.stealGrabMs;
      }
      return true;
    }
    case 'done': {
      if (!due) return false;
      const at = w.deadline!;
      if (w.index + 1 < s.words.length && (w.index + 1) % s.config.wordsPerRound === 0) {
        startIntermission(s, at);
        fx.push({ type: 'cue', name: 'round' });
      } else if (w.index + 1 < s.words.length) openWord(s, w.index + 1, at);
      else {
        s.phase = 'final';
        s.word = null;
        fx.push({ type: 'cue', name: 'final' });
      }
      return true;
    }
  }
}
