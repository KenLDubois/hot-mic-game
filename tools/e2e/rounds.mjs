/**
 * Plays two rounds through the real app (two phones and a TV) and checks the intermission:
 * leaderboard with boo stats, ready-up with its minimum time, the host override, and the awards.
 * No LiveKit needed. Start the game server with short timers first:
 *
 *   HOT_MIC_RULES='{"grabMs":4000,"stealGrabMs":4000,"graceMs":400,"voteMs":4000,"resultHoldMs":1200,"stealCountdownMs":1000,"doneHoldMs":800,"intermissionMinMs":6000}' pnpm start
 *   node tools/e2e/rounds.mjs        SHOTS=/some/dir to keep screenshots
 */
import { closeBrowsers, check, createRoom, joinRoom, log, open, shot, sleep } from './lib.mjs';

const { page: ann, code } = await createRoom('Ann', 'Annes');
const ben = await joinRoom(code, 'Ben', { name: 'Bens' });
log('room', code);
const tv = await open('tv', { path: `/screen?room=${code}&household=h1`, viewport: { width: 1920, height: 1080 } });
await tv.waitForSelector('.tv-lobby');

// --- the host sets 2 rounds of 2 words
const stepper = (label) => ann.locator('.stepper', { hasText: label });
check((await stepper('Rounds').locator('strong').innerText()) === '1', 'the lobby starts with 1 round');
await stepper('Rounds').getByRole('button', { name: '+' }).click();
for (let i = 0; i < 3; i++) await stepper('Words per round').getByRole('button', { name: '−' }).click();
await sleep(300);
check((await stepper('Rounds').locator('strong').innerText()) === '2', 'the host sets 2 rounds');
check((await stepper('Words per round').locator('strong').innerText()) === '2', 'and 2 words per round');
check((await ben.locator('.waiting').innerText()).includes('2 rounds of 2 words'), "Ben's lobby shows 2 rounds of 2 words");
await ann.getByRole('button', { name: 'Start game' }).click();

const grabAndSing = async (page) => {
  await page.waitForSelector('.mic:not(.locked)', { timeout: 8000 });
  const b = await page.locator('.mic').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForSelector('.you-have');
  await sleep(700);
  await page.mouse.up();
};
const vote = async (page, kind) => {
  await page.waitForSelector('.votes', { timeout: 8000 });
  await page.getByRole('button', { name: new RegExp(kind) }).click();
};

// --- round 1, word 1: Ben sings, Ann says Hurray. Word 2: nobody grabs.
check((await ann.locator('.topbar').innerText()).includes('Round 1 of 2 · Word 1 of 2'), 'the header shows round and word');
check((await tv.locator('.tv-top-mid').innerText()).includes('Round 1 of 2 · Word 1 of 2'), 'and so does the TV');
await grabAndSing(ben);
await vote(ann, 'Hurray');

// --- intermission
await ann.waitForSelector('.intermission', { timeout: 20000 });
await ben.waitForSelector('.intermission');
await tv.waitForSelector('.tv-inter');
const t0 = Date.now();
check((await ann.locator('h2', { hasText: 'Round 1 done' }).count()) === 1, 'the phone says round 1 is done');
const row = (page, name) => page.locator('.leaders tr', { hasText: name }).innerText();
check(/Ben\s+2\s+0\s+0/.test(await row(ann, 'Ben')), "Ben's row: 2 points, no boos");
check(/Ann.*\s0\s+0\s+0/.test(await row(ann, 'Ann')), "Ann's row: 0 points");
check(/boos cast/i.test(await tv.locator('.tv-leaders').innerText()), 'the TV leaderboard shows the boo stats');
await shot(ann, 'rounds-1-intermission-phone');
await shot(tv, 'rounds-2-intermission-tv');

await ann.getByRole('button', { name: 'Ready' }).click();
await ben.getByRole('button', { name: 'Ready' }).click();
await tv.waitForFunction(() => document.querySelectorAll('.tv-tick.on').length === 2);
check(true, 'the TV ticks off who is ready');
await sleep(1500);
check((await ann.locator('.intermission').count()) === 1 && Date.now() - t0 < 5500, 'everyone ready, but the round waits out the minimum time');
await ann.waitForSelector('.word', { timeout: 10000 });
check(Date.now() - t0 >= 5500, `the next round started after the minimum (${Date.now() - t0} ms)`);
check((await ann.locator('.topbar').innerText()).includes('Round 2 of 2 · Word 1 of 2'), 'round 2 starts at word 1');

// --- round 2, word 3: Ann sings and Ben boos her; Ben steals it and Ann says Hurray.
await grabAndSing(ann);
await vote(ben, 'Boo');
await ann.waitForSelector('text=Mic opens in');
await ben.waitForSelector('.mic:not(.locked)', { timeout: 8000 });
await grabAndSing(ben);
await vote(ann, 'Hurray');

// --- the game ends after word 4 times out; no second intermission
await ann.waitForSelector('.awards', { timeout: 20000 });
const awards = await ann.locator('.awards').innerText();
check(awards.includes('Most Generous') && awards.includes('Ann'), 'Most Generous goes to Ann (2 Hurrays)');
check(awards.includes('Most Stolen From') && awards.includes('Ann'), 'Most Stolen From goes to Ann');
check(!awards.includes('Biggest Hater'), 'nobody earned Biggest Hater, so it is left out');
check((await ann.locator('h2', { hasText: 'Round 2 done' }).count()) === 0, 'no intermission after the last round');
await tv.waitForSelector('.tv-awards');
check(/most stolen from/i.test(await tv.locator('.tv-awards').innerText()), 'the TV shows the awards');
await shot(ann, 'rounds-3-final-phone');
await shot(tv, 'rounds-4-final-tv');
await closeBrowsers();
