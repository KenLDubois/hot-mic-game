import { fileURLToPath } from 'node:url';
import { liveKitFromEnv } from './livekit.js';
import { createGameServer } from './server.js';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const media = liveKitFromEnv(process.env);
if (!media) console.log('LIVEKIT_URL, LIVEKIT_API_KEY or LIVEKIT_API_SECRET is not set: running without built-in audio');

// Shorter timers for testing, e.g. HOT_MIC_RULES='{"grabMs":4000,"intermissionMinMs":5000}'.
const rules = process.env.HOT_MIC_RULES ? JSON.parse(process.env.HOT_MIC_RULES) : undefined;

const server = createGameServer({
  rules,
  media: media ?? undefined,
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
