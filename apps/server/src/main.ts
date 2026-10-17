import { fileURLToPath } from 'node:url';
import { createGameServer } from './server.js';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const server = createGameServer({
  packsDir: process.env.PACKS_DIR ?? here('../../../packs'),
  staticDir: process.env.STATIC_DIR ?? here('../../web/dist'),
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port).then((p) => console.log(`Hot Mic server listening on :${p}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close().finally(() => process.exit(0));
  });
}
