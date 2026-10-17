import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('engine boundary', () => {
  it('imports nothing except packages/shared and itself, and does no I/O or timing', () => {
    const dir = fileURLToPath(new URL('../src', import.meta.url));
    for (const file of readdirSync(dir)) {
      const src = readFileSync(`${dir}/${file}`, 'utf8');
      const specs = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      for (const s of specs) expect(s.startsWith('.') || s === '@hot-mic/shared', `${file} imports ${s}`).toBe(true);
      expect(src, file).not.toMatch(/setTimeout|setInterval|Date\.now|Math\.random|console\./);
    }
  });
});
