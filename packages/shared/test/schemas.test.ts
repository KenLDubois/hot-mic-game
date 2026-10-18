import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { packJsonSchemas } from '../src/schemas.js';

describe('committed JSON Schemas', () => {
  for (const [file, schema] of Object.entries(packJsonSchemas())) {
    it(`${file} is up to date (run \`pnpm schemas\` if not)`, () => {
      const committed = readFileSync(fileURLToPath(new URL(`../../../schemas/${file}`, import.meta.url)), 'utf8');
      expect(JSON.parse(committed)).toEqual(JSON.parse(JSON.stringify(schema)));
    });
  }
});
