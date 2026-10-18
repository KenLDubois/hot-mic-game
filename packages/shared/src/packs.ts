import { z, type ZodIssue } from 'zod';
import type { CueName } from './types.js';

/** Largest pack the game will take, so an upload can't ask for the moon. */
export const PACK_LIMITS = {
  maxBytes: 300_000,
  maxWords: 5000,
  maxQuestions: 2000,
  maxWordLength: 40,
  maxQuestionLength: 240,
  maxChoiceLength: 100,
};

/** What a theme pack's files may add up to. */
export const THEME_LIMITS = {
  maxZipBytes: 4_000_000,
  maxFiles: 24,
  maxImageBytes: 1_000_000,
  maxSoundBytes: 300_000,
};

export const THEME_COLORS = ['bg', 'panel', 'panel2', 'text', 'muted', 'primary', 'accent', 'good', 'bad'] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];

/** The game's own colors, which a theme overrides one by one. */
export const DEFAULT_THEME_COLORS: Record<ThemeColor, string> = {
  bg: '#14101f',
  panel: '#211a33',
  panel2: '#2b2342',
  text: '#f4f0ff',
  muted: '#9d93b8',
  primary: '#ff7a00',
  accent: '#8a4fff',
  good: '#3ddc84',
  bad: '#ff4d6d',
};

/** Fonts are picked from this list and drawn from fonts already on the device, so no font files load. */
export const THEME_FONTS = ['system', 'serif', 'rounded', 'mono', 'display', 'handwriting'] as const;
export type ThemeFont = (typeof THEME_FONTS)[number];

/** The sound cues a theme can replace (the TV plays them). */
export const THEME_CUES = ['grab', 'boo', 'point', 'steal', 'round', 'final'] as const satisfies readonly CueName[];

export const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
export const SOUND_TYPES: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg' };

const link = z
  .string()
  .max(500)
  .regex(/^https?:\/\/\S+$/, 'must be a web link starting with http:// or https://');

export const wordPackSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('words'),
  name: z.string().trim().min(1).max(60),
  words: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(PACK_LIMITS.maxWordLength),
        difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
      }),
    )
    .min(1)
    .max(PACK_LIMITS.maxWords),
});

export const triviaQuestionSchema = z
  .object({
    question: z.string().trim().min(1).max(PACK_LIMITS.maxQuestionLength),
    choices: z.array(z.string().trim().min(1).max(PACK_LIMITS.maxChoiceLength)).min(2).max(4),
    /** Index of the correct choice. */
    answer: z.number().int().min(0),
    source: link.optional(),
    /** Set by the generator when it could not confirm the answer; the host sees a warning. */
    unconfirmed: z.boolean().optional(),
  })
  .superRefine((q, ctx) => {
    if (q.answer >= q.choices.length) ctx.addIssue({ code: 'custom', path: ['answer'], message: 'out-of-range' });
    const seen = new Set<string>();
    for (const c of q.choices) {
      const key = c.trim().toLowerCase();
      if (seen.has(key)) return void ctx.addIssue({ code: 'custom', path: ['choices'], message: `same-choice:${c}` });
      seen.add(key);
    }
  });

export const triviaPackSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('trivia'),
  name: z.string().trim().min(1).max(60),
  questions: z.array(triviaQuestionSchema).min(1).max(PACK_LIMITS.maxQuestions),
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must look like #1a2b3c');
/** A file inside the pack: plain letters, digits, dots, dashes and folders. */
const assetPath = z
  .string()
  .max(100)
  .regex(/^(?!.*\.\.)[a-zA-Z0-9][a-zA-Z0-9_.-]*(\/[a-zA-Z0-9_.-]+)*$/, 'must be a file path inside the pack, like "bg.png"');

export const themePackSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('theme'),
    name: z.string().trim().min(1).max(60),
    /** Words and questions that join the game's pools while this theme is selected. */
    words: wordPackSchema.shape.words.optional(),
    questions: triviaPackSchema.shape.questions.optional(),
    /** Tokens only: no custom CSS or scripts. */
    style: z
      .object({
        colors: z.object(Object.fromEntries(THEME_COLORS.map((c) => [c, hexColor.optional()])) as Record<ThemeColor, z.ZodOptional<typeof hexColor>>).strict().optional(),
        font: z.enum(THEME_FONTS).optional(),
        background: assetPath.optional(),
        sounds: z.object(Object.fromEntries(THEME_CUES.map((c) => [c, assetPath.optional()])) as Record<(typeof THEME_CUES)[number], z.ZodOptional<typeof assetPath>>).strict().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type WordPack = z.infer<typeof wordPackSchema>;
export type TriviaPack = z.infer<typeof triviaPackSchema>;
export type TriviaQuestion = z.infer<typeof triviaQuestionSchema>;
export type ThemePack = z.infer<typeof themePackSchema>;
export type Pack = WordPack | TriviaPack | ThemePack;
export type PackKind = Pack['type'];

/** What the host sees before using a pack. */
export type PackPreview =
  | { kind: 'words'; name: string; count: number; words: string[] }
  | { kind: 'trivia'; name: string; count: number; questions: TriviaQuestion[]; unconfirmed: number }
  | {
      kind: 'theme';
      name: string;
      /** Words the theme adds. */
      count: number;
      questions: number;
      words: string[];
      colors: Partial<Record<ThemeColor, string>>;
      font: ThemeFont;
      background: boolean;
      sounds: string[];
    };

export type PackCheck = { ok: true; pack: Pack } | { ok: false; errors: string[] };

const shorten = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n)}…` : s);

function describeTheme(issue: ZodIssue): string | null {
  const [top, a, b] = issue.path;
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys.map((k) => `"${k}"`).join(', ');
    if (top === undefined) return `Unknown field ${keys} in the theme (a theme has "name", "words", "questions" and "style")`;
    if (top === 'style' && a === undefined) return `Unknown style setting ${keys}. Styles are tokens only: "colors", "font", "background" and "sounds" (no custom CSS or code)`;
    if (a === 'colors') return `Unknown color ${keys}. Colors are ${THEME_COLORS.join(', ')}`;
    if (a === 'sounds') return `Unknown sound ${keys}. Sounds are ${THEME_CUES.join(', ')}`;
  }
  if (top !== 'style') return null;
  if (a === 'colors' && typeof b === 'string') return `Color "${b}" ${issue.message}`;
  if (a === 'font') return `"font" must be one of: ${THEME_FONTS.join(', ')}`;
  if (a === 'background') return `"background" ${issue.message}`;
  if (a === 'sounds' && typeof b === 'string') return `Sound "${b}" ${issue.message}`;
  return null;
}

/** One sentence naming exactly what is wrong and where, in the author's terms. */
function describe(issue: ZodIssue, json: unknown): string {
  const [top, index, field] = issue.path;
  const at = typeof index === 'number' ? index + 1 : null;
  const list = (json as { words?: unknown[]; questions?: unknown[] })?.[top as 'words' | 'questions'];
  const item = typeof index === 'number' && Array.isArray(list) ? list[index] : undefined;
  const missing = issue.code === 'invalid_type' && issue.received === 'undefined';

  if ((json as { type?: unknown })?.type === 'theme') {
    const themeError = describeTheme(issue);
    if (themeError) return themeError;
  }

  if (top === 'words' && at !== null) {
    const text = (item as { text?: unknown })?.text;
    const label = typeof text === 'string' && text ? `Word ${at} ("${shorten(text)}")` : `Word ${at}`;
    if (field === 'text') {
      if (missing || (issue.code === 'too_small')) return `${label} has no text`;
      if (issue.code === 'too_big') return `${label} is longer than ${PACK_LIMITS.maxWordLength} characters`;
      return `${label}: "text" must be a string`;
    }
    if (field === 'difficulty') return `${label}: difficulty must be "easy", "medium" or "hard"`;
    return `Word ${at} must be an object like { "text": "fire" }`;
  }

  if (top === 'questions' && at !== null) {
    const q = (item as { choices?: unknown[] } | undefined) ?? {};
    const label = `Question ${at}`;
    switch (field) {
      case 'question':
        return issue.code === 'too_big'
          ? `${label} is longer than ${PACK_LIMITS.maxQuestionLength} characters`
          : `${label} has no question text`;
      case 'choices': {
        if (issue.message.startsWith('same-choice:')) return `${label} has the same choice twice ("${shorten(issue.message.slice(12))}")`;
        const n = Array.isArray(q.choices) ? q.choices.length : 0;
        if (issue.path[3] !== undefined) return `${label}: choice ${Number(issue.path[3]) + 1} is empty or too long (up to ${PACK_LIMITS.maxChoiceLength} characters)`;
        return `${label} needs 2 to 4 choices, not ${n}`;
      }
      case 'answer': {
        const n = Array.isArray(q.choices) ? q.choices.length : 0;
        if (missing) return `${label} has no correct answer (add "answer": the number of the right choice, starting at 0)`;
        if (issue.message === 'out-of-range') return `${label}: answer ${(item as { answer?: number }).answer} is not one of its ${n} choices (use 0 to ${n - 1})`;
        return `${label}: "answer" must be a whole number, the position of the right choice starting at 0`;
      }
      case 'source':
        return `${label}: source ${issue.message}`;
      case 'unconfirmed':
        return `${label}: "unconfirmed" must be true or false`;
      default:
        return `${label} must be an object with "question", "choices" and "answer"`;
    }
  }

  if (top === 'schemaVersion') return '"schemaVersion" must be 1';
  if (top === 'type') return '"type" must be "words", "trivia" or "theme"';
  if (top === 'name') return 'The pack needs a "name" (up to 60 characters)';
  if (top === 'words') return issue.code === 'too_big' ? `A word pack can have up to ${PACK_LIMITS.maxWords} words` : 'A word pack needs a "words" list with at least one word';
  if (top === 'questions') return issue.code === 'too_big' ? `A trivia pack can have up to ${PACK_LIMITS.maxQuestions} questions` : 'A trivia pack needs a "questions" list with at least one question';
  return `${issue.path.join('.') || 'The pack'}: ${issue.message}`;
}

/** Checks a pack file's text and returns the pack, or every problem found (at most 20). */
export function checkPack(text: string): PackCheck {
  if (text.length > PACK_LIMITS.maxBytes) {
    return { ok: false, errors: [`The file is larger than ${Math.round(PACK_LIMITS.maxBytes / 1000)} KB`] };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`Not valid JSON: ${(err as Error).message}`] };
  }
  return checkPackJson(json);
}

export function checkPackJson(json: unknown): PackCheck {
  const type = (json as { type?: unknown } | null)?.type;
  const schema =
    type === 'words' ? wordPackSchema : type === 'trivia' ? triviaPackSchema : type === 'theme' ? themePackSchema : null;
  if (!schema) {
    return { ok: false, errors: ['"type" must be "words", "trivia" or "theme"'] };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const errors = [...new Set(parsed.error.issues.map((i) => describe(i, json)))];
    return { ok: false, errors: errors.slice(0, 20) };
  }
  if (parsed.data.type === 'theme') {
    const errors = readableColors(parsed.data);
    if (errors.length) return { ok: false, errors };
  }
  return { ok: true, pack: parsed.data };
}

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
/** WCAG contrast ratio of two #rrggbb colors, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Dark text on the primary buttons. */
export const BUTTON_TEXT = '#1a1020';

/** Text must stay readable on the colors a theme picks. */
function readableColors(theme: ThemePack): string[] {
  const c = { ...DEFAULT_THEME_COLORS, ...theme.style?.colors };
  const errors: string[] = [];
  const need = (fg: string, bg: string, label: string, min: number) => {
    const ratio = contrast(fg, bg);
    if (ratio < min) errors.push(`${label} is hard to read (contrast ${ratio.toFixed(1)}:1, needs ${min}:1)`);
  };
  need(c.text, c.bg, 'The "text" color on "bg"', 4.5);
  need(c.text, c.panel, 'The "text" color on "panel"', 4.5);
  need(c.text, c.panel2, 'The "text" color on "panel2"', 4.5);
  need(c.muted, c.bg, 'The "muted" color on "bg"', 3);
  need(BUTTON_TEXT, c.primary, 'The dark button text on "primary"', 4.5);
  return errors;
}

/**
 * Checks the files that came with a theme: every file it points to is there, is the right kind
 * and size, and the whole bundle is not too big. `files` maps a path to its size in bytes.
 */
export function checkThemeFiles(theme: ThemePack, files: ReadonlyMap<string, number>): string[] {
  const errors: string[] = [];
  const extension = (path: string) => path.split('.').pop()?.toLowerCase() ?? '';
  const total = [...files.values()].reduce((n, size) => n + size, 0);
  if (files.size > THEME_LIMITS.maxFiles) errors.push(`The theme has ${files.size} files; the most is ${THEME_LIMITS.maxFiles}`);
  if (total > THEME_LIMITS.maxZipBytes) errors.push(`The theme's files add up to more than ${THEME_LIMITS.maxZipBytes / 1_000_000} MB`);
  const refs: [string, string | undefined, Record<string, string>, number][] = [
    ['"background"', theme.style?.background, IMAGE_TYPES, THEME_LIMITS.maxImageBytes],
    ...THEME_CUES.map((cue): [string, string | undefined, Record<string, string>, number] => [
      `Sound "${cue}"`,
      theme.style?.sounds?.[cue],
      SOUND_TYPES,
      THEME_LIMITS.maxSoundBytes,
    ]),
  ];
  for (const [label, path, types, max] of refs) {
    if (!path) continue;
    const size = files.get(path);
    if (size === undefined) errors.push(`${label} points to "${path}", which is not in the pack`);
    else if (!(extension(path) in types)) errors.push(`${label}: "${path}" must be ${Object.keys(types).map((e) => `.${e}`).join(', ')}`);
    else if (size > max) errors.push(`${label}: "${path}" is larger than ${Math.round(max / 1000)} KB`);
  }
  return errors.slice(0, 20);
}

export function previewPack(pack: Pack): PackPreview {
  if (pack.type === 'words') {
    return { kind: 'words', name: pack.name, count: pack.words.length, words: pack.words.slice(0, 15).map((w) => w.text) };
  }
  if (pack.type === 'trivia') {
    return {
      kind: 'trivia',
      name: pack.name,
      count: pack.questions.length,
      questions: pack.questions.slice(0, 3),
      unconfirmed: pack.questions.filter((q) => q.unconfirmed).length,
    };
  }
  const style = pack.style ?? {};
  return {
    kind: 'theme',
    name: pack.name,
    count: pack.words?.length ?? 0,
    questions: pack.questions?.length ?? 0,
    words: (pack.words ?? []).slice(0, 15).map((w) => w.text),
    colors: style.colors ?? {},
    font: style.font ?? 'system',
    background: !!style.background,
    sounds: THEME_CUES.filter((cue) => style.sounds?.[cue]),
  };
}
