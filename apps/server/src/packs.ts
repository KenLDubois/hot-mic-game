import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { checkPack, type Pack, type PackInfo, type TriviaQuestion } from '@hot-mic/shared';

export interface LoadedPack {
  id: string;
  pack: Pack;
  /** Uploaded to one room, not built in. */
  uploaded?: boolean;
}

/** Loads every valid word and trivia pack in a folder. The file name (without .json) is the pack id. */
export function loadPacks(dir: string): LoadedPack[] {
  const packs: LoadedPack[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const checked = checkPack(readFileSync(join(dir, file), 'utf8'));
    if (!checked.ok) {
      console.warn(`packs: ${file} is not a valid pack: ${checked.errors[0]}`);
      continue;
    }
    packs.push({ id: basename(file, '.json'), pack: checked.pack });
  }
  return packs;
}

export function packInfo(packs: LoadedPack[]): PackInfo[] {
  return packs.map(({ id, pack, uploaded }) => ({
    id,
    name: pack.name,
    kind: pack.type,
    count: pack.type === 'words' ? uniqueWords(pack.words.map((w) => w.text)).length : uniqueQuestions(pack.questions).length,
    uploaded: !!uploaded,
  }));
}

function uniqueWords(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const key = w.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w.trim());
  }
  return out;
}

function uniqueQuestions(questions: TriviaQuestion[]): TriviaQuestion[] {
  const seen = new Set<string>();
  return questions.filter((q) => {
    const key = q.question.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** All distinct words from the chosen word packs, shuffled, so a game never repeats a word. */
export function selectWords(
  packs: LoadedPack[],
  packIds: string[],
  random: () => number = Math.random,
): string[] {
  const chosen = packs.filter((p) => packIds.includes(p.id));
  const words = uniqueWords(chosen.flatMap((p) => (p.pack.type === 'words' ? p.pack.words.map((w) => w.text) : [])));
  return shuffle(words, random);
}

export function availableWords(packs: LoadedPack[], packIds: string[]): number {
  return selectWords(packs, packIds).length;
}

/** All distinct questions from the chosen trivia packs, shuffled, so a game never repeats a question. */
export function selectQuestions(
  packs: LoadedPack[],
  packIds: string[],
  random: () => number = Math.random,
): TriviaQuestion[] {
  const chosen = packs.filter((p) => packIds.includes(p.id));
  return shuffle(uniqueQuestions(chosen.flatMap((p) => (p.pack.type === 'trivia' ? p.pack.questions : []))), random);
}

export function availableQuestions(packs: LoadedPack[], packIds: string[]): number {
  return selectQuestions(packs, packIds).length;
}
