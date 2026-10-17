import type { PlayerView, View, WordView } from '@hot-mic/shared';
import { canGrab, eligibleVoters } from './engine.js';
import type { GameState } from './state.js';

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
      vote: attempt?.votes[playerId] ?? null,
      canGrab: !!w && w.status === 'open' && canGrab(s, w, playerId),
    },
    wordNumber: w ? w.index + 1 : 0,
    totalWords: s.words.length,
    // The server fills these in; devices and media are not game rules.
    devices: [],
    word,
  };
}
