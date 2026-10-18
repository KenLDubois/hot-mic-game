/** Writes the pack JSON Schemas to schemas/. Run with `pnpm schemas` after changing packages/shared/src/packs.ts. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { packJsonSchemas } from '../packages/shared/src/schemas.js';

const dir = fileURLToPath(new URL('../schemas/', import.meta.url));
mkdirSync(dir, { recursive: true });
for (const [file, schema] of Object.entries(packJsonSchemas())) {
  writeFileSync(dir + file, `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote schemas/${file}`);
}
