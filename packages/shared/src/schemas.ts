import { zodToJsonSchema } from 'zod-to-json-schema';
import { themePackSchema, triviaPackSchema, wordPackSchema } from './packs.js';

/**
 * JSON Schemas for the pack files, generated from the Zod schemas the server checks uploads with.
 * Not exported from the package index: only the generator script and its test use it.
 * A JSON Schema can't say "answer is one of the choices" or "no repeated choice", so the Zod
 * checks are stricter than these; use them for editor hints, and the game's own check for the final word.
 */
export function packJsonSchemas(): Record<string, object> {
  const make = (title: string, schema: Parameters<typeof zodToJsonSchema>[0]) => ({
    title,
    ...zodToJsonSchema(schema, { $refStrategy: 'none' }),
  });
  return {
    'word-pack.schema.json': make('Hot Mic word pack', wordPackSchema),
    'trivia-pack.schema.json': make('Hot Mic trivia pack', triviaPackSchema),
    'theme-pack.schema.json': make('Hot Mic theme pack (theme.json inside the zip)', themePackSchema),
  };
}
