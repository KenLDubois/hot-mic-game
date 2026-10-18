/**
 * Plays with themes through the real app: two phones and a TV in real browsers.
 * Start the game server with short timers first (no LiveKit needed):
 *
 *   HOT_MIC_RULES='{"grabMs":4000,"stealGrabMs":4000,"graceMs":400,"voteMs":3000,"resultHoldMs":1200,"stealCountdownMs":1000,"doneHoldMs":800}' pnpm start
 *   node tools/e2e/theme.mjs        SHOTS=/some/dir to keep screenshots
 */
import { createRequire } from 'node:module';
import { closeBrowsers, check, createRoom, joinRoom, log, open, shot, sleep } from './lib.mjs';

const { zipSync, strToU8 } = createRequire(import.meta.url)(new URL('../../apps/server/node_modules/fflate', import.meta.url).pathname);

const { page: ann, code } = await createRoom('Ann', 'Annes');
const ben = await joinRoom(code, 'Ben', { name: 'Bens' });
log('room', code);
const tv = await open('tv', { path: `/screen?room=${code}&household=h1`, viewport: { width: 1920, height: 1080 } });
await tv.waitForSelector('.tv-lobby');

const look = (page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    return {
      primary: root.getPropertyValue('--primary').trim(),
      bg: root.getPropertyValue('--bg').trim(),
      font: body.fontFamily,
      image: body.backgroundImage,
    };
  });

// --- plain to begin with
let l = await look(ann);
check(l.primary === '#ff7a00' && l.image === 'none', 'no theme: the plain look');
await shot(ann, 'theme-0-plain');

// --- the built-in Halloween theme reaches every device
const halloween = ann.locator('.pack-row', { hasText: 'Halloween' });
check((await halloween.innerText()).includes('built in'), 'Halloween is listed as a built-in theme');
await halloween.getByRole('button', { name: 'Preview' }).click();
await ann.waitForSelector('.pack-preview .theme-swatches');
check((await ann.locator('.pack-preview').innerText()).includes('Font: display'), 'its preview shows the font and colors');
await ann.locator('.pack-preview').getByRole('button', { name: 'Close' }).click();
await halloween.locator('input').click();
await ann.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() === '#ff7a1a');
for (const [who, page] of [['Ann', ann], ['Ben', ben], ['the TV', tv]]) {
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() === '#ff7a1a');
  l = await look(page);
  check(l.bg === '#0e0a14' && /Impact/.test(l.font) && /background\.svg/.test(l.image), `${who} gets the Halloween colors, font and background`);
}
const bgUrl = (await look(ben)).image.match(/url\("?(.*?)"?\)/)[1];
check(await ben.evaluate(async (u) => (await fetch(u)).ok, bgUrl), 'the background picture loads');
await shot(ann, 'theme-1-halloween-lobby');
await shot(tv, 'theme-2-halloween-tv');

// --- back to plain
await ann.locator('.pack-row', { hasText: 'Plain' }).locator('input').click();
await ben.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() === '#ff7a00');
check((await look(ben)).image === 'none', 'choosing Plain puts the plain look back for everyone');

// --- uploads: a broken zip says what is wrong
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(40)]);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#223"/></svg>';
const theme = {
  schemaVersion: 1,
  type: 'theme',
  name: 'Ocean',
  words: [{ text: 'wave' }, { text: 'tide' }],
  style: { colors: { bg: '#06202e', panel: '#0b3347', panel2: '#10445d', primary: '#5ee0ff', accent: '#ffd166' }, font: 'rounded', background: 'bg.svg', sounds: { point: 'ding.wav' } },
};
const zip = (files) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v instanceof Buffer ? new Uint8Array(v) : strToU8(JSON.stringify(v))]))));
const file = (name, buffer) => ({ name, mimeType: 'application/zip', buffer });
await ann.locator('input[type=file]').setInputFiles(file('ocean.zip', zip({ 'theme.json': theme, 'bg.svg': '<svg><script>alert(1)</script></svg>', 'ding.wav': wav })));
await ann.waitForSelector('.pack-errors');
const err = await ann.locator('.pack-errors').innerText();
check(err.includes('ocean.zip') && err.includes('"bg.svg" contains scripts'), 'a theme with a scripted picture is refused, naming the file');
await shot(ann, 'theme-3-errors');
await ann.locator('.pack-errors').getByRole('button', { name: 'Dismiss' }).click();

await ann.locator('input[type=file]').setInputFiles(file('ocean.zip', zip({ 'theme.json': { ...theme, style: { ...theme.style, css: 'body{display:none}' } }, 'bg.svg': svg, 'ding.wav': wav })));
await ann.waitForSelector('.pack-errors');
check((await ann.locator('.pack-errors').innerText()).includes('no custom CSS or code'), 'custom CSS is refused');
await ann.locator('.pack-errors').getByRole('button', { name: 'Dismiss' }).click();

// --- a good zip previews, then applies to everyone
await ann.locator('input[type=file]').setInputFiles(file('ocean.zip', zip({ 'theme.json': theme, 'bg.svg': svg, 'ding.wav': wav })));
await ann.waitForSelector('.pack-preview');
const preview = await ann.locator('.pack-preview').innerText();
check(preview.includes('Ocean') && preview.includes('Font: rounded') && preview.includes('sounds: point'), 'a good theme zip previews first');
await ann.getByRole('button', { name: 'Use this pack' }).click();
await ben.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() === '#5ee0ff');
check(/ui-rounded/.test((await look(ben)).font) && /upload-1\/bg\.svg/.test((await look(ben)).image), 'Ben gets the uploaded theme');
check(await ann.locator('.pack-row', { hasText: 'Ocean' }).locator('input').isChecked(), 'and it is selected');
await shot(ben, 'theme-4-ocean-phone');

// --- the TV plays the theme's sounds in the game
const wanted = [];
tv.on('request', (r) => { if (r.url().includes('/sounds/') || r.url().endsWith('ding.wav')) wanted.push(r.url()); });
await ann.locator('.pack-row', { hasText: 'Halloween' }).locator('input').click();
const stepper = (label) => ann.locator('.stepper', { hasText: label });
for (let i = 0; i < 4; i++) await stepper('Words per round').getByRole('button', { name: '−' }).click();
await ann.getByRole('button', { name: 'Start game' }).click();
await ann.waitForSelector('.mic:not(.locked)', { timeout: 8000 });
const b = await ann.locator('.mic').boundingBox();
await ann.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await ann.mouse.down();
await ann.waitForSelector('.you-have');
await sleep(600);
await ann.mouse.up();
await ben.waitForSelector('.votes', { timeout: 8000 });
await ben.getByRole('button', { name: /Boo/ }).click();
await sleep(300);
await shot(tv, 'theme-5-halloween-game-tv');
await shot(ben, 'theme-6-halloween-game-phone');
await ann.waitForSelector('text=Back to lobby', { timeout: 40000 }).catch(() => {});
check(wanted.some((u) => u.includes('/halloween/sounds/')), `the TV fetched the theme's sound files (${wanted.map((u) => u.split('/').pop()).join(', ')})`);
await closeBrowsers();
