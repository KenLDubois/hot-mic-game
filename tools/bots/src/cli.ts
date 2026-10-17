import { parseArgs } from 'node:util';
import { BEHAVIORS, Bot, type Behavior } from './bot.js';

const { values } = parseArgs({
  options: {
    room: { type: 'string', short: 'r' },
    count: { type: 'string', short: 'n', default: '3' },
    behavior: { type: 'string', short: 'b', default: 'normal' },
    household: { type: 'string', default: 'Bots' },
    url: { type: 'string', default: 'http://localhost:3000' },
    create: { type: 'boolean', default: false },
    words: { type: 'string' },
    rounds: { type: 'string' },
    speed: { type: 'string', default: '1' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || (!values.room && !values.create)) {
  console.log(`Usage: pnpm bots --room ABCD [--count 3] [--behavior normal] [--household Bots]
       pnpm bots --create --count 4 --words 5 [--rounds 2]   (bots host and play their own game)

Behaviors: ${BEHAVIORS.join(', ')}
Options:   --url http://localhost:3000   --speed 1 (scales all delays; 0.2 is five times faster)`);
  process.exit(values.help ? 0 : 1);
}

const behavior = values.behavior as Behavior;
if (!BEHAVIORS.includes(behavior)) {
  console.error(`Unknown behavior "${behavior}". Pick one of: ${BEHAVIORS.join(', ')}`);
  process.exit(1);
}

const count = Number(values.count);
const speed = Number(values.speed);
const log = (m: string) => console.log(m);
const mk = (i: number) =>
  new Bot({ url: values.url!, name: `Bot ${i + 1}`, behavior, speed, log });
const bots = Array.from({ length: count }, (_, i) => mk(i));

let room = values.room?.toUpperCase();
if (values.create) {
  room = (await bots[0]!.create(values.household!)).roomCode;
  console.log(`Created room ${room}`);
} else {
  await bots[0]!.join(room!, values.household!);
}
for (const bot of bots.slice(1)) await bot.join(room!, values.household!);
console.log(`${count} bots (${behavior}) in room ${room}. Ctrl+C to stop.`);

if (values.create && values.words) {
  await bots[0]!.setConfig({ wordsPerRound: Number(values.words), ...(values.rounds ? { rounds: Number(values.rounds) } : {}) });
  await bots[0]!.startGame();
  console.log('Game started');
}

process.on('SIGINT', () => {
  bots.forEach((b) => b.stop());
  process.exit(0);
});
