import { z } from 'zod';

export const wordPackSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('words'),
  name: z.string().min(1),
  words: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(40),
        difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
      }),
    )
    .min(1),
});

export type WordPack = z.infer<typeof wordPackSchema>;
