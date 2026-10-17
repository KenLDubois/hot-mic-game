/**
 * Plays two households through the real app in real browsers against a real LiveKit server, and
 * checks who sends and who hears. Chromium's fake microphone supplies the singing.
 *
 *   livekit-server --dev --bind 127.0.0.1 --node-ip 127.0.0.1   (any local LiveKit; --dev uses key devkey, secret secret)
 *   LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret pnpm build && pnpm start
 *   node tools/e2e/audio.mjs                       (needs `playwright` installed globally or in NODE_PATH)
 *
 * URL=https://localhost to go through Caddy instead; CHROMIUM=/path/to/chrome if Playwright's own is missing.
 */
import { closeBrowsers, check, createRoom, joinRoom, log, shot, sleep, stats } from './lib.mjs';

const { page: ann, code } = await createRoom('Ann', 'Annes');
log('room', code);
const join = (name, household) => joinRoom(code, name, household);
const al = await join('Al', { existing: 'Annes' });
const ben = await join('Ben', { name: 'Bens' });

// Lobby: mic check with a live meter, on every phone
for (const [n, p] of [['ann', ann], ['al', al], ['ben', ben]]) {
  const mc = p.locator('.mic-check');
  const btn = mc.getByRole('button', { name: 'Allow microphone' });
  if (await btn.count()) await btn.click();
  await p.waitForSelector('.mic-check[data-mic="granted"] .meter');
  await sleep(500);
  const lvl = await p.locator('.meter').getAttribute('aria-valuenow');
  check(true, `${n}: mic permission granted, meter shown (level ${lvl})`);
}
await sleep(1500);
const text = (p) => p.locator('.speaker-panel').innerText();
check((await text(ann)).includes('This device plays the singers'), 'ann (first in household) is the speaker');
check((await text(al)).includes('Another device in your house plays the sound'), 'al is not the speaker');
check((await text(ben)).includes('This device plays the singers'), 'ben is the speaker of his house');
check((await ann.locator('.speaker-panel input[type=radio]').count()) === 2, 'household with two phones shows a speaker picker');

// start the game; Ben (other household) sings
await ann.getByRole('button', { name: 'Start game' }).click();
await ben.waitForSelector('.mic:not(.locked)');
const box = await ben.locator('.mic').boundingBox();
await ben.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await ben.mouse.down();
await ben.waitForSelector('.you-have');
const before = { ann: await stats(ann), al: await stats(al), ben: await stats(ben) };
await sleep(4000);
const mid = { ann: await stats(ann), al: await stats(al), ben: await stats(ben) };
check(mid.ben.outbound > before.ben.outbound + 2000, 'ben (singer) is sending audio');
check(mid.ann.inbound > before.ann.inbound + 2000, 'ann (speaker in the other house) receives audio');
check(mid.ann.energy > before.ann.energy, 'ann receives actual signal (audio energy rises)');
check(mid.al.inbound === before.al.inbound, 'al (second phone in ann\'s house) receives nothing');
check(mid.ben.inbound === before.ben.inbound, 'ben receives nothing of his own song');

// waveform on other screens: LiveKit reports the singer's level
const annWave = await ann.evaluate(() => document.querySelector('.waveform') !== null);
check(annWave, 'ann sees a waveform while ben sings');

// release: mic goes mute during grace, then voting revokes sending
await ben.mouse.up();
await sleep(300);
const afterRelease = await stats(ben);
await sleep(1000);
const quiet = await stats(ben);
check(quiet.outbound - afterRelease.outbound < 4000, 'ben sends (almost) nothing while the button is up');
await ann.waitForSelector('.votes', { timeout: 5000 });
await ann.getByRole('button', { name: /Hurray/ }).click();
await ben.waitForSelector('text=Waiting for the votes', { timeout: 10000 });
await sleep(1500);
const pub = await ben.evaluate(async () => {
  let tracks = 0;
  for (const pc of window.__pcs) for (const s of pc.getSenders()) if (s.track && s.track.kind === 'audio' && s.track.readyState === 'live') tracks++;
  return tracks;
});
check(pub === 0, `ben has no live published audio track after voting starts (${pub})`);
await shot(ann, 'ann-voting');
await shot(ben, 'ben-voting');

// speaker switching: make al the speaker
await al.getByRole('button', { name: /Sound/ }).click();
await al.locator('.speaker-panel label', { hasText: 'This device' }).locator('input').click();
await sleep(1000);
check((await text(al)).includes('This device plays the singers'), 'al becomes the speaker after picking');
await ann.getByRole('button', { name: /Sound/ }).click();
check((await text(ann)).includes('Another device in your house plays the sound'), 'ann stops being the speaker');

// next word: Ann sings; her own house (speaker al) must hear nothing, Ben's house hears her
await ann.waitForSelector('.mic:not(.locked)', { timeout: 30000 });
await shot(ann, 'ann-word2');
const b2 = await ann.locator('.mic').boundingBox();
const s0 = { ann: await stats(ann), al: await stats(al), ben: await stats(ben) };
await ann.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
await ann.mouse.down();
await ann.waitForSelector('.you-have');
await sleep(4000);
const s1 = { ann: await stats(ann), al: await stats(al), ben: await stats(ben) };
check(s1.ann.outbound > s0.ann.outbound + 2000, 'ann (second song) sends audio');
check(s1.ben.inbound > s0.ben.inbound + 2000 && s1.ben.energy > s0.ben.energy, 'ben (speaker elsewhere) hears ann');
check(s1.al.inbound === s0.al.inbound, "al (ann's house's speaker) hears nothing of ann");
await shot(ben, 'ben-hearing');
const peaks = await ben.evaluate(async () => {
  const c = document.querySelector('.waveform'); const ctx = c.getContext('2d'); let max = 0;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let top = c.height; for (let y = 0; y < c.height; y++) { for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 0) { top = y; break; } if (top < c.height) break; }
    max = Math.max(max, c.height - 2 * top);
  }
  return max;
});
check(peaks > 12, `ben's waveform moves while ann sings (peak bar height ${peaks}px)`);
await ann.mouse.up();
await sleep(3500);

// failover: the speaker leaves, the other phone takes over
await al.close();
await sleep(1500);
check((await text(ann)).includes('This device plays the singers'), 'ann takes over when the speaker phone leaves');
await closeBrowsers();
