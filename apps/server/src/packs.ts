import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { checkPack, type Pack, type PackInfo, type TriviaQuestion } from '@hot-mic/shared';
import { loadThemeDir, type ThemeAsset } from './themes.js';

export interface LoadedPack {
  id: string;
  pack: Pack;
  /** Uploaded to one room, not built in. */
  uploaded?: boolean;
  /** Theme packs only: the files its style points to, by path inside the pack. */
  assets?: Map<string, ThemeAsset>;
}

/**
 * Loads every valid pack in a folder. The file name (without .json) is the pack id.
 * Theme packs are folders under themes/, with theme.json and their assets; the folder name is the id.
 */
export function loadPacks(dir: string): LoadedPack[] {
  const packs: LoadedPack[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const checked = checkPack(readFileSync(join(dir, file), 'utf8'));
    if (!checked.ok) {
      console.warn(`packs: ${file} is not a valid pack: ${checked.errors[0]}`);
      continue;
    }
    if (checked.pack.type === 'theme') {
      console.warn(`packs: ${file} is a theme; put themes in packs/themes/<name>/theme.json with their files`);
      continue;
    }
    packs.push({ id: basename(file, '.json'), pack: checked.pack });
  }
  const themes = join(dir, 'themes');
  if (existsSync(themes)) {
    for (const folder of readdirSync(themes).sort()) {
      if (!existsSync(join(themes, folder, 'theme.json'))) continue;
      const loaded = loadThemeDir(join(themes, folder));
      if (!loaded.ok) console.warn(`packs: theme ${folder} is not valid: ${loaded.errors[0]}`);
      else packs.push({ id: folder, pack: loaded.pack, assets: loaded.assets });
    }
  }
  return packs;
}

export function packInfo(packs: LoadedPack[]): PackInfo[] {
  return packs.map(({ id, pack, uploaded }) => ({
    id,
    name: pack.name,
    kind: pack.type,
    count: pack.type === 'trivia' ? questionsOf(pack).length : wordsOf(pack).length,
    ...(pack.type === 'theme' ? { questions: questionsOf(pack).length } : {}),
    uploaded: !!uploaded,
  }));
}

/** The words a pack adds: a word pack's list, or the words bundled in a theme. */
function wordsOf(pack: Pack): string[] {
  if (pack.type === 'trivia') return [];
  return uniqueWords((pack.type === 'words' ? pack.words : (pack.words ?? [])).map((w) => w.text));
}

function questionsOf(pack: Pack): TriviaQuestion[] {
  if (pack.type === 'words') return [];
  return uniqueQuestions(pack.type === 'trivia' ? pack.questions : (pack.questions ?? []));
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
  const words = uniqueWords(chosen.flatMap((p) => wordsOf(p.pack)));
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
  return shuffle(uniqueQuestions(chosen.flatMap((p) => questionsOf(p.pack))), random);
}

export function availableQuestions(packs: LoadedPack[], packIds: string[]): number {
  return selectQuestions(packs, packIds).length;
}
