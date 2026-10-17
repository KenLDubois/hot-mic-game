import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { wordPackSchema, type PackInfo, type WordPack } from '@hot-mic/shared';

export interface LoadedPack {
  id: string;
  pack: WordPack;
}

/** Loads every valid word pack in a folder. The file name (without .json) is the pack id. */
export function loadPacks(dir: string): LoadedPack[] {
  const packs: LoadedPack[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (err) {
      console.warn(`packs: ${file} is not valid JSON (${(err as Error).message})`);
      continue;
    }
    const parsed = wordPackSchema.safeParse(json);
    if (!parsed.success) {
      // Other pack types arrive in later milestones; only warn about word packs.
      if ((json as { type?: string })?.type === 'words') {
        console.warn(`packs: ${file} is not a valid word pack: ${parsed.error.issues[0]?.message}`);
      }
      continue;
    }
    packs.push({ id: basename(file, '.json'), pack: parsed.data });
  }
  return packs;
}

export function packInfo(packs: LoadedPack[]): PackInfo[] {
  return packs.map((p) => ({ id: p.id, name: p.pack.name, wordCount: uniqueWords(p.pack.words.map((w) => w.text)).length }));
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

/** All distinct words from the chosen packs, shuffled, so a game never repeats a word. */
export function selectWords(
  packs: LoadedPack[],
  packIds: string[],
  random: () => number = Math.random,
): string[] {
  const chosen = packs.filter((p) => packIds.includes(p.id));
  const words = uniqueWords(chosen.flatMap((p) => p.pack.words.map((w) => w.text)));
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [words[i], words[j]] = [words[j]!, words[i]!];
  }
  return words;
}

export function availableWords(packs: LoadedPack[], packIds: string[]): number {
  return selectWords(packs, packIds).length;
}
