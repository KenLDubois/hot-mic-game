import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import {
  checkPack,
  checkThemeFiles,
  IMAGE_TYPES,
  SOUND_TYPES,
  THEME_CUES,
  THEME_LIMITS,
  type ThemePack,
} from '@hot-mic/shared';

export interface ThemeAsset {
  /** The media type the file is served with. */
  type: string;
  data: Uint8Array;
}

export type ThemeLoad =
  | { ok: true; pack: ThemePack; assets: Map<string, ThemeAsset> }
  | { ok: false; errors: string[] };

const extension = (path: string) => path.split('.').pop()?.toLowerCase() ?? '';
const startsWith = (data: Uint8Array, bytes: number[], at = 0) => bytes.every((b, i) => data[at + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Whether a file's first bytes match what its extension says, so a renamed file is caught. */
function looksLike(path: string, data: Uint8Array): boolean {
  switch (extension(path)) {
    case 'png':
      return startsWith(data, [0x89, 0x50, 0x4e, 0x47]);
    case 'jpg':
    case 'jpeg':
      return startsWith(data, [0xff, 0xd8]);
    case 'webp':
      return startsWith(data, ascii('RIFF')) && startsWith(data, ascii('WEBP'), 8);
    case 'wav':
      return startsWith(data, ascii('RIFF')) && startsWith(data, ascii('WAVE'), 8);
    case 'ogg':
      return startsWith(data, ascii('OggS'));
    case 'mp3':
      return startsWith(data, ascii('ID3')) || (data[0] === 0xff && ((data[1] ?? 0) & 0xe0) === 0xe0);
    case 'svg':
      return true;
    default:
      return false;
  }
}

/** An SVG is a document; one that can run code is refused. */
const unsafeSvg = (data: Uint8Array) =>
  /<script|<foreignObject|\son[a-z]+\s*=|javascript:/i.test(new TextDecoder().decode(data));

/** Checks the files of a theme (from a zip or a folder) and keeps the ones the manifest uses. */
export function readThemeFiles(files: Record<string, Uint8Array>): ThemeLoad {
  const manifest = files['theme.json'];
  if (!manifest) return { ok: false, errors: ['The zip has no theme.json at its top level'] };
  const checked = checkPack(new TextDecoder().decode(manifest));
  if (!checked.ok) return checked;
  if (checked.pack.type !== 'theme') return { ok: false, errors: ['theme.json must have "type": "theme"'] };
  const pack = checked.pack;

  const sizes = new Map(Object.entries(files).filter(([name]) => name !== 'theme.json').map(([name, data]) => [name, data.byteLength]));
  const errors = checkThemeFiles(pack, sizes);

  const used = [pack.style?.background, ...THEME_CUES.map((cue) => pack.style?.sounds?.[cue])].filter((p): p is string => !!p);
  const assets = new Map<string, ThemeAsset>();
  for (const path of used) {
    const data = files[path];
    if (!data || errors.length) continue;
    if (!looksLike(path, data)) errors.push(`"${path}" is not really a .${extension(path)} file`);
    else if (extension(path) === 'svg' && unsafeSvg(data)) errors.push(`"${path}" contains scripts, which are not allowed`);
    else assets.set(path, { type: IMAGE_TYPES[extension(path)] ?? SOUND_TYPES[extension(path)]!, data });
  }
  return errors.length ? { ok: false, errors: errors.slice(0, 20) } : { ok: true, pack, assets };
}

/** Unpacks a theme zip. Sizes are checked before anything is inflated. */
export function readThemeZip(data: Uint8Array): ThemeLoad {
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  let count = 0;
  try {
    const raw = unzipSync(data, {
      filter: ({ name, originalSize }) => {
        if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.endsWith('.DS_Store')) return false;
        total += originalSize;
        if (++count > THEME_LIMITS.maxFiles || total > THEME_LIMITS.maxZipBytes) throw new Error('too-big');
        return true;
      },
    });
    // Zipping a folder puts everything one level down; allow that.
    const names = Object.keys(raw);
    const prefix = names.includes('theme.json') ? '' : (names.find((n) => n.endsWith('/theme.json'))?.slice(0, -'theme.json'.length) ?? '');
    for (const [name, bytes] of Object.entries(raw)) if (name.startsWith(prefix)) files[name.slice(prefix.length)] = bytes;
  } catch (err) {
    if ((err as Error).message === 'too-big') {
      return {
        ok: false,
        errors: [`The zip is too big: at most ${THEME_LIMITS.maxFiles} files and ${THEME_LIMITS.maxZipBytes / 1_000_000} MB unpacked`],
      };
    }
    return { ok: false, errors: ['That is not a valid zip file'] };
  }
  return readThemeFiles(files);
}

/** Reads a theme from a folder holding theme.json and its assets. */
export function loadThemeDir(dir: string): ThemeLoad {
  const files: Record<string, Uint8Array> = {};
  const walk = (sub: string) => {
    for (const entry of readdirSync(join(dir, sub))) {
      const rel = sub ? `${sub}/${entry}` : entry;
      if (statSync(join(dir, rel)).isDirectory()) walk(rel);
      else files[rel] = readFileSync(join(dir, rel));
    }
  };
  walk('');
  return readThemeFiles(files);
}
