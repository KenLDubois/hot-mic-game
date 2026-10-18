import type { AwardView, View } from '@hot-mic/shared';

/** "Round 2 of 3 · Word 1 of 5", or just the word when the game is a single round. */
export function progressLabel(view: View): string {
  if (view.phase === 'final') return 'Game over';
  if (view.phase === 'intermission') return `Round ${view.roundNumber} of ${view.totalRounds} done`;
  const word = `Word ${view.wordInRound} of ${view.config.wordsPerRound}`;
  return view.totalRounds > 1 ? `Round ${view.roundNumber} of ${view.totalRounds} · ${word}` : word;
}

export const AWARD_TITLES: Record<AwardView['kind'], { title: string; why: (n: number) => string }> = {
  hater: { title: 'Biggest Hater', why: (n) => `${n} overruled ${n === 1 ? 'boo' : 'boos'}` },
  generous: { title: 'Most Generous', why: (n) => `${n} ${n === 1 ? 'Hurray' : 'Hurrays'}` },
  stolen: { title: 'Most Stolen From', why: (n) => `booed ${n} ${n === 1 ? 'time' : 'times'} before someone else scored` },
};

export function awardWinners(a: AwardView, view: View): string {
  const names = a.playerIds.map((id) => view.players.find((p) => p.id === id)?.name ?? 'Someone');
  return names.join(' & ');
}
