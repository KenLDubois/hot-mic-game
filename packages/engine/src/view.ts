import type { AwardView, IntermissionView, PlayerView, View, WordView } from '@hot-mic/shared';
import { canGrab, eligibleVoters } from './engine.js';
import type { GameState } from './state.js';

/** The three final awards. Ties share one, and one nobody earned is left out. */
export function awards(s: GameState): AwardView[] {
  const players = s.playerOrder.map((id) => s.players[id]!).filter((p) => !p.kicked);
  const by = (kind: AwardView['kind'], value: (p: (typeof players)[number]) => number): AwardView[] => {
    const top = Math.max(0, ...players.map(value));
    if (top === 0) return [];
    return [{ kind, value: top, playerIds: players.filter((p) => value(p) === top).map((p) => p.id) }];
  };
  return [
    ...by('hater', (p) => p.stats.overruledBoos),
    ...by('generous', (p) => p.stats.hurraysCast),
    ...by('stolen', (p) => p.stats.stolenFrom),
  ];
}

function intermissionView(s: GameState, playerId: string): IntermissionView | null {
  const im = s.intermission;
  if (!im) return null;
  const t = im.trivia;
  const revealed = im.stage !== 'question';
  return {
    stage: im.stage,
    revealUntil: im.revealUntil,
    minUntil: im.minUntil,
    ready: im.ready,
    trivia: t && {
      id: t.id,
      question: t.question,
      choices: t.choices,
      answered: Object.keys(t.answers),
      eligible: s.playerOrder.filter((id) => s.players[id]!.connected && !s.players[id]!.kicked).length,
      mine: t.answers[playerId] ?? null,
      correct: revealed ? t.answer : null,
      picks: revealed ? Object.entries(t.answers).map(([id, choice]) => ({ playerId: id, choice })) : null,
      source: revealed ? t.source : null,
    },
  };
}

/**
 * The complete view for one device. Other players' votes appear only as a
 * count until the result; a device always sees its own vote.
 */
export function viewFor(s: GameState, playerId: string, now: number, roomCode: string): View {
  const w = s.word;
  const attempt = w?.attempt ?? null;
  const players: PlayerView[] = s.playerOrder.map((id) => {
    const p = s.players[id]!;
    return {
      id: p.id,
      name: p.name,
      householdId: p.householdId,
      connected: p.connected,
      kicked: p.kicked,
      isHost: id === s.hostId,
      score: p.score,
      stats: p.stats,
    };
  });

  let word: WordView | null = null;
  if (w) {
    word = {
      id: w.id,
      text: w.text,
      status: w.status,
      deadline: w.status === 'singing' ? null : w.deadline,
      isSteal: w.isSteal,
      lockedOut: w.lockedOut,
      singerId: attempt?.singerId ?? null,
      attemptId: attempt?.id ?? null,
      held: attempt?.held ?? false,
      graceDeadline: w.status === 'singing' ? (attempt?.graceAt ?? null) : null,
      capDeadline: w.status === 'singing' ? (attempt?.capAt ?? null) : null,
      voteCount: attempt ? Object.keys(attempt.votes).length : 0,
      eligibleVoters: eligibleVoters(s, w).length,
      result: w.result,
      outcome: w.outcome,
    };
  }

  return {
    version: s.version,
    serverTime: now,
    roomCode,
    phase: s.phase,
    config: s.config,
    hostId: s.hostId ?? '',
    players,
    households: s.households,
    you: {
      screen: false,
      playerId,
      isHost: playerId === s.hostId,
      ready: !!s.intermission?.ready.includes(playerId),
      answered: s.intermission?.trivia?.answers[playerId] !== undefined,
      vote: attempt?.votes[playerId] ?? null,
      canGrab: !!w && w.status === 'open' && canGrab(s, w, playerId),
    },
    roundNumber: s.phase === 'lobby' ? 0 : s.roundIndex + 1,
    totalRounds: s.config.rounds,
    wordInRound: w ? (w.index % s.config.wordsPerRound) + 1 : 0,
    wordNumber: w ? w.index + 1 : 0,
    totalWords: s.words.length,
    intermission: intermissionView(s, playerId),
    awards: s.phase === 'final' ? awards(s) : [],
    // The server fills these in; devices and media are not game rules.
    devices: [],
    theme: null,
    word,
  };
}
