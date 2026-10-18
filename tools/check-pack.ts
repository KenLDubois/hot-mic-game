/**
 * Checks pack files the way the lobby upload does, for people and for the pack-generator skill.
 *   pnpm packs:check packs/my-words.json packs/themes/halloween my-theme.zip
 *   pnpm packs:check --require-sources packs/my-trivia.json
 * With --require-sources, every trivia question needs a source link or "unconfirmed": true.
 * Exits 1 if anything is wrong.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkPack, type Pack, type TriviaQuestion } from '../packages/shared/src/index.js';
import { loadThemeDir, readThemeZip, type ThemeLoad } from '../apps/server/src/themes.js';

const args = process.argv.slice(2);
const requireSources = args.includes('--require-sources');
const paths = args.filter((a) => !a.startsWith('--'));
// pnpm runs this from apps/server; paths are relative to where the person typed the command.
const base = process.env.INIT_CWD ?? process.cwd();

if (paths.length === 0) {
  console.error('Usage: pnpm packs:check [--require-sources] <pack.json | theme.zip | theme folder>...');
  process.exit(2);
}

type Loaded = { ok: true; pack: Pack } | { ok: false; errors: string[] };

function load(path: string): Loaded {
  if (!existsSync(path)) return { ok: false, errors: ['No such file or folder'] };
  if (statSync(path).isDirectory()) return fromTheme(loadThemeDir(path));
  if (path.toLowerCase().endsWith('.zip')) return fromTheme(readThemeZip(readFileSync(path)));
  return checkPack(readFileSync(path, 'utf8'));
}
const fromTheme = (t: ThemeLoad): Loaded => (t.ok ? { ok: true, pack: t.pack } : t);

/** Things that are not wrong enough to refuse the pack, but a host should know. */
function warnings(questions: TriviaQuestion[]): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  questions.forEach((q, i) => {
    const label = `Question ${i + 1} ("${q.question.slice(0, 40)}${q.question.length > 40 ? '…' : ''}")`;
    if (q.unconfirmed) notes.push(`${label} is flagged unconfirmed: check it before playing`);
    else if (!q.source) problems.push(`${label} has no source link (add "source", or "unconfirmed": true if you could not confirm it)`);
    const key = q.question.trim().toLowerCase();
    if (seen.has(key)) notes.push(`${label} repeats an earlier question`);
    seen.add(key);
  });
  return { problems, notes };
}

let failed = false;
for (const arg of paths) {
  const path = resolve(base, arg);
  const result = load(path);
  if (!result.ok) {
    failed = true;
    console.log(`✗ ${arg}`);
    for (const e of result.errors) console.log(`    ${e}`);
    continue;
  }
  const { pack } = result;
  const questions = pack.type === 'trivia' ? pack.questions : (pack.type === 'theme' ? pack.questions : undefined) ?? [];
  const counts =
    pack.type === 'words'
      ? `${pack.words.length} words`
      : pack.type === 'trivia'
        ? `${pack.questions.length} questions`
        : `${pack.words?.length ?? 0} words, ${questions.length} questions`;
  const { problems, notes } = warnings(questions);
  const bad = requireSources ? problems : [];
  if (bad.length) failed = true;
  console.log(`${bad.length ? '✗' : '✓'} ${arg}: ${pack.type} pack "${pack.name}", ${counts}`);
  for (const p of bad) console.log(`    ${p}`);
  for (const n of [...(requireSources ? [] : problems), ...notes]) console.log(`    note: ${n}`);
}
process.exit(failed ? 1 : 0);
