/**
 * Puts the TV main screen through a real game in a 1920x1080 browser: join by code, attach to a
 * household, show every state, play the household's sound, and stay quiet for its own singer.
 * Same setup as audio.mjs (a local LiveKit and the game server with LIVEKIT_* set).
 *
 *   node tools/e2e/tv.mjs        SHOTS=/some/dir to keep a screenshot of every state
 */
import { closeBrowsers, check, createRoom, joinRoom, log, open, shot, sleep, stats } from './lib.mjs';

const TV = { width: 1920, height: 1080 };
const { page: ann, code } = await createRoom('Ann', 'Annes');
const ben = await joinRoom(code, 'Ben', { name: 'Bens' });

// --- the TV joins by code and picks a household
const tvA = await open('tvA', { path: '/screen', viewport: TV });
await tvA.fill('.tv-code', code);
await tvA.getByRole('button', { name: 'Continue' }).click();
await tvA.waitForSelector('text=Which household');
await shot(tvA, 'tv-1-pick-household');
await tvA.getByRole('button', { name: 'Annes' }).click();
await tvA.waitForSelector('.tv-lobby');
await sleep(1000);

const lobbyText = await tvA.locator('.tv-lobby').innerText();
check(lobbyText.includes(code) && lobbyText.includes('Ann') && lobbyText.includes('Ben'), 'TV lobby shows the room code and players by household');
check((await tvA.locator('.tv-qr rect').count()) > 100, 'TV lobby shows a QR code');
await shot(tvA, 'tv-2-lobby');

// the phones know about the TV, and it is the sound for its household
await ann.waitForSelector('text=Your TV plays the sound');
check(true, "Ann's phone says the TV plays the sound for the household");
check((await ann.locator('.tv-hint-card').count()) === 0, 'the "add a TV" hint goes away once a TV is attached');

// a second TV for the other household
// (opened from the link a phone offers, so it joins by itself, with no press to unlock sound)
const tvB = await open('tvB', { path: `/screen?room=${code}&household=h2`, viewport: TV, noActivation: true });
await tvB.waitForSelector('.tv-lobby');
await tvB.waitForSelector('.tv-gate button');
check(true, 'a TV opened from a link joins by itself and asks for one press to turn the sound on');
await tvB.locator('.tv-gate button').click();
await tvB.waitForSelector('.tv-gate', { state: 'detached' });

// the TV has no controls: nothing on it is a game button
const buttons = await tvA.locator('button').count();
check(buttons === 0, `the TV has no buttons once it is in the room (${buttons})`);

// --- play a word: Ben (other household) sings
await ann.getByRole('button', { name: 'Start game' }).click();
await tvA.waitForSelector('.tv-word');
await shot(tvA, 'tv-3-word-open');
check((await tvA.locator('.tv-count').innerText()).trim().match(/^\d+$/) !== null, 'TV shows a big countdown on the word');
const word = (await tvA.locator('.tv-word').innerText()).trim();
check(word.length > 0 && word === (await ben.locator('.word').innerText()).trim(), `TV shows the same word as the phones ("${word}")`);

await ben.waitForSelector('.mic:not(.locked)');
const box = await ben.locator('.mic').boundingBox();
await ben.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
const oscBefore = await tvA.evaluate(() => window.__oscillators);
await ben.mouse.down();
await tvA.waitForSelector('.tv-singer');
check((await tvA.locator('.tv-singer').innerText()).includes('Ben has the mic'), 'TV names the singer');
const before = { a: await stats(tvA), b: await stats(tvB), ann: await stats(ann) };
await sleep(4000);
const mid = { a: await stats(tvA), b: await stats(tvB), ann: await stats(ann) };
await shot(tvA, 'tv-4-singing');
check(mid.a.inbound > before.a.inbound + 2000 && mid.a.energy > before.a.energy, "Annes' TV plays Ben's singing");
check(mid.b.inbound === before.b.inbound, "Bens' TV (the singer's own house) hears nothing");
check(mid.ann.inbound === before.ann.inbound, "Ann's phone plays nothing: the TV is the speaker");
check((await tvA.evaluate(() => window.__oscillators)) > oscBefore, 'TV played a sound cue when the mic was grabbed');
const votesText = await tvA.locator('.tv-votes').innerText();
check(/of \d+ votes in/.test(votesText), `TV shows how many votes are in, not which way ("${votesText}")`);

await ben.mouse.up();
await ann.waitForSelector('.votes', { timeout: 5000 });
await tvA.waitForSelector('text=Vote on your phone', { timeout: 5000 });
await shot(tvA, 'tv-5-voting');
await ann.getByRole('button', { name: /Boo/ }).click();
await tvA.waitForSelector('.tv-verdict', { timeout: 15000 });
await tvA.waitForSelector('.tv-tally', { timeout: 15000 });
await shot(tvA, 'tv-6-result');
const tally = await tvA.locator('.tv-tally').innerText();
check(tally.includes('Ann'), 'TV result shows who voted which way');
const oscAfter = await tvA.evaluate(() => window.__oscillators);
check(oscAfter > oscBefore + 2, 'TV played a sound cue for the result');

// a steal if boo won, otherwise next word; either way the TV keeps following along
await sleep(8000);
await shot(tvA, 'tv-7-after');
const scores = await tvA.locator('.tv-scores li').allInnerTexts();
check(scores.length === 2, 'TV shows a scoreboard');

// overflow: nothing on the TV page scrolls
const overflow = await tvA.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1);
check(!overflow, 'the TV page fits 1920x1080 without scrolling');

// a reload keeps the TV in its room
await tvA.reload();
await tvA.waitForSelector('.tv-root', { timeout: 8000 });
check(true, 'reloading the TV rejoins the same room');

// the TV leaves: Ann's phone becomes the speaker again
await tvA.close();
await sleep(1500);
await ann.getByRole('button', { name: /Sound/ }).click();
await ann.waitForFunction(() => document.querySelector('.speaker-panel')?.innerText.includes('This device plays the singers'), null, { timeout: 5000 });
check(true, "Ann's phone takes the sound back when the TV leaves");

await closeBrowsers();
