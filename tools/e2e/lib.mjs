/** Shared helpers for the real-browser checks: Playwright, fake microphone, WebRTC stats. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const URL = process.env.URL ?? 'http://localhost:3000';
export const SHOTS = process.env.SHOTS;
export const log = (...a) => console.log(...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const check = (ok, msg) => { log(ok ? 'PASS' : 'FAIL', msg); if (!ok) process.exitCode = 1; };
export const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : undefined);

export const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
});
export const closeBrowsers = () => browser.close();

/** A fresh browser profile on `path`, recording its peer connections and the oscillators it plays. noActivation: act like a browser nobody has pressed anything in yet. */
export async function open(name, { path = '/', viewport = { width: 400, height: 800 }, noActivation = false } = {}) {
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport });
  await ctx.addInitScript(() => {
    window.__pcs = [];
    const Orig = window.RTCPeerConnection;
    window.RTCPeerConnection = function (...a) { const pc = new Orig(...a); window.__pcs.push(pc); return pc; };
    window.RTCPeerConnection.prototype = Orig.prototype;
    window.__oscillators = 0;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (...a) { window.__oscillators++; return create.apply(this, a); };
  });
  if (noActivation) {
    // Headless Chromium reports user activation from the start; real browsers wait for a press.
    await ctx.addInitScript(() => {
      const state = { hasBeenActive: false, isActive: false };
      Object.defineProperty(navigator, 'userActivation', { value: state });
      for (const type of ['click', 'keydown', 'pointerdown']) addEventListener(type, () => (state.hasBeenActive = true), { capture: true });
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`[${name}] pageerror`, e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('DATA_TRACK')) log(`[${name}] console.error`, m.text()); });
  await page.goto(URL + path);
  return page;
}

export async function stats(page) {
  return page.evaluate(async () => {
    const out = { inbound: 0, outbound: 0, energy: 0, pcs: window.__pcs.length };
    for (const pc of window.__pcs) {
      (await pc.getStats()).forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') { out.inbound += r.bytesReceived ?? 0; out.energy += r.totalAudioEnergy ?? 0; }
        if (r.type === 'outbound-rtp' && r.kind === 'audio') out.outbound += r.bytesSent ?? 0;
      });
    }
    return out;
  });
}

/** Create a room on a phone; returns the page and the room code. */
export async function createRoom(name, household) {
  const page = await open(name);
  await page.fill('input[placeholder="Ken"]', name);
  await page.getByText('Create a room').click();
  await page.fill('input[placeholder*="place" i]', household);
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForSelector('.room-code');
  return { page, code: (await page.textContent('.room-code')).trim() };
}

/** Join an existing room on a phone, into an existing household ({existing}) or a new one ({name}). */
export async function joinRoom(code, name, household) {
  const p = await open(name);
  await p.fill('input[placeholder="Ken"]', name);
  await p.fill('.code-input', code);
  await p.getByRole('button', { name: 'Join room' }).click();
  await p.waitForSelector('text=Which household');
  if (household.existing) await p.getByLabel(household.existing).check();
  else { await p.getByLabel('A new household').check(); await p.fill('input[placeholder="Household name"]', household.name); }
  await p.getByRole('button', { name: 'Join', exact: true }).click();
  await p.waitForSelector('.lobby');
  return p;
}
