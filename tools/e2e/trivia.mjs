/**
 * Plays trivia and pack upload through the real app: two phones and a TV in real browsers.
 * No LiveKit needed. Start the game server with short timers first, like rounds.mjs:
 *
 *   HOT_MIC_RULES='{"grabMs":3000,"doneHoldMs":600,"triviaRevealMs":3000,"intermissionMinMs":4000}' pnpm start
 *   node tools/e2e/trivia.mjs        SHOTS=/some/dir to keep screenshots
 */
import { closeBrowsers, check, createRoom, joinRoom, log, open, shot, sleep } from './lib.mjs';

const { page: ann, code } = await createRoom('Ann', 'Annes');
const ben = await joinRoom(code, 'Ben', { name: 'Bens' });
log('room', code);
const tv = await open('tv', { path: `/screen?room=${code}&household=h1`, viewport: { width: 1920, height: 1080 } });
await tv.waitForSelector('.tv-lobby');

const stepper = (label) => ann.locator('.stepper', { hasText: label });
await stepper('Rounds').getByRole('button', { name: '+' }).click();
for (let i = 0; i < 4; i++) await stepper('Words per round').getByRole('button', { name: '−' }).click();

// --- trivia on, and the built-in pack can be previewed
await ann.getByLabel('Music trivia between rounds').click();
await ann.waitForSelector('legend:has-text("Trivia packs")');
const music = ann.locator('.pack-row', { hasText: 'Music trivia' });
check(/\(4\d questions\)/.test(await music.innerText()), 'the built-in music trivia pack shows its question count');
await music.getByRole('button', { name: 'Preview' }).click();
await ann.waitForSelector('.pack-preview');
check((await ann.locator('.pack-preview').innerText()).includes('✓'), 'previewing a trivia pack marks the right answer');
await shot(ann, 'trivia-1-preview');
await ann.locator('.pack-preview').getByRole('button', { name: 'Close' }).click();

// --- a broken pack file says exactly what is wrong
const good = { schemaVersion: 1, type: 'trivia', name: 'Mine', questions: [{ question: 'Pick the second one', choices: ['First', 'Second', 'Third'], answer: 1 }] };
const broken = { ...good, name: 'Broken', questions: [good.questions[0], { question: 'No answer here', choices: ['x', 'y'] }] };
const file = (name, data) => ({ name, mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) });
await ann.locator('input[type=file]').setInputFiles(file('broken.json', broken));
await ann.waitForSelector('.pack-errors');
const err = await ann.locator('.pack-errors').innerText();
check(err.includes('broken.json') && err.includes('Question 2 has no correct answer'), 'a pack with no answer is refused: "Question 2 has no correct answer"');
await shot(ann, 'trivia-2-errors');
await ann.locator('.pack-errors').getByRole('button', { name: 'Dismiss' }).click();
await ann.locator('input[type=file]').setInputFiles(file('typo.json', '{ "type": "trivia", '));
await ann.waitForSelector('.pack-errors');
check((await ann.locator('.pack-errors').innerText()).includes('Not valid JSON'), 'a file that is not JSON says so');
await ann.locator('.pack-errors').getByRole('button', { name: 'Dismiss' }).click();

// --- a good pack shows a preview, then is added and selected
await ann.locator('input[type=file]').setInputFiles(file('mine.json', good));
await ann.waitForSelector('.pack-preview');
check((await ann.locator('.pack-preview').innerText()).includes('Pick the second one'), 'a good pack shows a preview first');
await ann.getByRole('button', { name: 'Use this pack' }).click();
const mine = ann.locator('.pack-row', { hasText: 'Mine' });
await mine.waitFor();
check((await mine.innerText()).includes('uploaded'), 'the uploaded pack is in the list');
check(await mine.locator('input').isChecked(), 'and selected');
await music.locator('input').click(); // the uploaded question is the only one, so its answer is known
await sleep(300);
check((await ben.locator('.waiting').innerText()).includes('music trivia'), "Ben's lobby mentions music trivia");

await ann.getByRole('button', { name: 'Start game' }).click();

// --- round 1: nobody grabs, then the question
await ann.waitForSelector('.trivia', { timeout: 15000 });
await ben.waitForSelector('.trivia');
await tv.waitForSelector('.tv-trivia');
check((await ann.locator('.question').innerText()) === 'Pick the second one', 'the phone shows the question');
check((await tv.locator('.tv-question').innerText()) === 'Pick the second one', 'and so does the TV');
check((await ann.locator('.choice').count()) === 3, 'with its three choices');
await shot(ann, 'trivia-3-question-phone');
await ann.locator('.choice', { hasText: 'Second' }).click();
await sleep(300);
check((await ann.locator('.trivia .hint').innerText()).includes('Locked in'), 'an answer locks in');
check((await ann.locator('.choice').first().isDisabled()), 'and cannot be changed');
await tv.waitForSelector('.tv-who.done');
check((await tv.locator('.tv-who.done').count()) === 1 && !(await tv.locator('.tv-trivia').innerText()).includes('Second ✓'), 'the TV shows who has answered, not what');
await shot(tv, 'trivia-4-question-tv');
await ben.locator('.choice', { hasText: 'First' }).click();

// --- reveal
await ann.waitForSelector('.choice.correct');
await ben.waitForSelector('.choice.correct');
check((await ann.locator('.verdict').innerText()).includes('Correct'), 'Ann got it right');
check((await ben.locator('.verdict').innerText()).includes('Not this time'), 'Ben did not');
check((await ben.locator('.choice.wrong').innerText()).includes('First'), "Ben's wrong pick is marked");
await tv.waitForSelector('.tv-choice.correct');
check((await tv.locator('.tv-choice.correct').innerText()).includes('Second') && (await tv.locator('.tv-choice.correct').innerText()).includes('Ann'), 'the TV reveals the answer and who picked it');
await shot(tv, 'trivia-5-reveal-tv');
await shot(ben, 'trivia-6-reveal-phone');

// --- leaderboard has the point; ready up; the game finishes (round 2 has one word, nobody grabs)
await ann.waitForSelector('.leaders', { timeout: 10000 });
check(/Ann.*\s1\s/.test(await ann.locator('.leaders tr', { hasText: 'Ann' }).innerText()), 'the leaderboard has Ann at 1 point');
await ann.getByRole('button', { name: 'Ready' }).click();
await ben.getByRole('button', { name: 'Ready' }).click();
await ann.waitForSelector('.word', { timeout: 10000 });
await ann.waitForSelector('text=Back to lobby', { timeout: 20000 });
check(true, 'round 2 plays on after the trivia, then the game ends');
await closeBrowsers();
