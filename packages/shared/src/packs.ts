import { z, type ZodIssue } from 'zod';

/** Largest pack the game will take, so an upload can't ask for the moon. */
export const PACK_LIMITS = {
  maxBytes: 300_000,
  maxWords: 5000,
  maxQuestions: 2000,
  maxWordLength: 40,
  maxQuestionLength: 240,
  maxChoiceLength: 100,
};

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

export type WordPack = z.infer<typeof wordPackSchema>;
export type TriviaPack = z.infer<typeof triviaPackSchema>;
export type TriviaQuestion = z.infer<typeof triviaQuestionSchema>;
export type Pack = WordPack | TriviaPack;
export type PackKind = Pack['type'];

/** What the host sees before using a pack. */
export type PackPreview =
  | { kind: 'words'; name: string; count: number; words: string[] }
  | { kind: 'trivia'; name: string; count: number; questions: TriviaQuestion[] };

export type PackCheck = { ok: true; pack: Pack } | { ok: false; errors: string[] };

const shorten = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** One sentence naming exactly what is wrong and where, in the author's terms. */
function describe(issue: ZodIssue, json: unknown): string {
  const [top, index, field] = issue.path;
  const at = typeof index === 'number' ? index + 1 : null;
  const list = (json as { words?: unknown[]; questions?: unknown[] })?.[top as 'words' | 'questions'];
  const item = typeof index === 'number' && Array.isArray(list) ? list[index] : undefined;
  const missing = issue.code === 'invalid_type' && issue.received === 'undefined';

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
      default:
        return `${label} must be an object with "question", "choices" and "answer"`;
    }
  }

  if (top === 'schemaVersion') return '"schemaVersion" must be 1';
  if (top === 'type') return '"type" must be "words" or "trivia"';
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
  if (type === 'theme') return { ok: false, errors: ['Theme packs are not supported yet'] };
  const schema = type === 'words' ? wordPackSchema : type === 'trivia' ? triviaPackSchema : null;
  if (!schema) {
    return { ok: false, errors: ['"type" must be "words" or "trivia"'] };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, pack: parsed.data };
  const errors = [...new Set(parsed.error.issues.map((i) => describe(i, json)))];
  return { ok: false, errors: errors.slice(0, 20) };
}

export function previewPack(pack: Pack): PackPreview {
  return pack.type === 'words'
    ? { kind: 'words', name: pack.name, count: pack.words.length, words: pack.words.slice(0, 15).map((w) => w.text) }
    : { kind: 'trivia', name: pack.name, count: pack.questions.length, questions: pack.questions.slice(0, 3) };
}
