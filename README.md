# Hot Mic

A self-hosted online party game, Pass The Mic meets Kahoot. A word appears, everyone races to grab the mic, and the winner has to sing a song containing that word. Everyone else votes Boo or Hurray.

The design doc and the build plan are the source of truth; this README only covers running and developing the code.

**Status: Milestone 6 (theme packs and the pack generator).** A game is the host's chosen rounds, with optional music trivia, an intermission leaderboard and ready-up between them, and awards at the end. Word, trivia and theme packs are plain JSON (themes with their files) that the host can add in the lobby. The singer's voice reaches every other household through the app, and a TV can show the game. Without the audio server (see below) the game still runs and can be played over a video call.

## Play it

You need Node 20+ and [pnpm](https://pnpm.io) (`corepack enable` is enough).

```sh
pnpm install
pnpm build        # builds the web app
pnpm start        # http://localhost:3000
```

Open it on a phone, create a room, and share the code or the invite link. Everyone picks or creates a household (everyone under one roof shares one).

Mic access needs HTTPS on a real phone, so for anything beyond localhost use Docker below.

### Audio

Audio goes through [LiveKit](https://livekit.io), a media server. Only the singer sends, only one device per household plays (the household's speaker, which players can change in the lobby or from Sound in the game), and a household never hears its own singer through the app. Each phone asks for the microphone in the lobby and shows a level meter. With no LiveKit configured the game runs without audio.

The game server turns audio on when these are set: `LIVEKIT_URL` (what browsers connect to, e.g. `wss://hotmic.example.com/livekit`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and optionally `LIVEKIT_API_URL` (what the server uses to reach LiveKit, default `LIVEKIT_URL` with `http`). Docker Compose does all of this for you.

For development, run a local LiveKit (`livekit-server --dev`) and start the game with `LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret pnpm dev`. Mic access works on `http://localhost`, but not from a phone on your network unless you use HTTPS.

### Docker Compose (HTTPS)

```sh
docker compose up --build
```

Copy `.env.example` to `.env` and fill in `LIVEKIT_API_SECRET` (the file says how). This runs the game server and LiveKit behind Caddy, which handles HTTPS automatically and passes audio signalling to LiveKit under `/livekit`. With nothing else set you get `https://localhost` using Caddy's local CA (run `docker compose exec caddy caddy trust` once, or accept the browser warning). For a real certificate point a domain at the machine, open ports 80 and 443, and put `DOMAIN=hotmic.example.com` in a `.env` file (see `.env.example`).

Audio itself travels directly between phones and LiveKit, not through Caddy: forward **7881/tcp** and **7882/udp** on your router to the machine for players outside your house. LiveKit finds the public address with STUN, so the machine needs outbound UDP. Players on the same network as the server may need your router to allow hairpin NAT (connecting to your own public address); if audio works for remote players but not for those at home, that is the usual cause.

### Develop

```sh
pnpm dev          # game server on :3000 + Vite on :5173 (proxied), with reload
pnpm test         # engine tests, scripted games, server + bots integration, audio permissions
pnpm typecheck
```

### Check audio in real browsers

`tools/e2e/audio.mjs` plays two households through the real app in Chromium (with a fake microphone) against a real LiveKit, and checks who sends and who hears. It needs Playwright and a `livekit-server` binary; the header of the file has the commands.

### Show the game on a TV

Open `/screen` in the TV's browser (or use the link in the lobby's "TV" hint, which fills in the room and household), enter the room code, and pick the household the TV is in. The screen shows the word, who is singing, the votes and the scores, and plays the cues. It has no controls. Press OK once so the browser lets it play sound; from then on the TV is its household's speaker and the phones there stay quiet. It is laid out for a 1080p TV.

`tools/e2e/tv.mjs` checks this in a 1920x1080 browser (same setup as the audio check).

### Rounds

The host picks the number of rounds and words per round in the lobby. Between rounds everyone sees the leaderboard (score, boos cast, overruled boos) and taps Ready; the next round starts once everyone connected is ready and 20 seconds have passed. The host can start it sooner. `tools/e2e/rounds.mjs` plays two rounds in real browsers; its header has the short-timer `HOT_MIC_RULES` to start the server with. `HOT_MIC_RULES` takes any of the timers in `packages/shared/src/config.ts` as JSON.

### Packs and trivia

Game content is plain JSON in `packs/`: word packs (`"type": "words"`) and trivia packs (`"type": "trivia"`, each question with 2 to 4 choices, the index of the right one as `answer`, and an optional `source` link). The file name is the pack id, and every valid file in the folder is offered in the lobby. With trivia on, everyone answers one music question between rounds (a correct answer is 1 point) before the leaderboard.

In the lobby the host can preview any pack, or choose a pack file from their device: the server checks it, says exactly what is wrong (for example `Question 12 has no correct answer`), and shows a preview before the pack is added to that room. Uploaded packs last as long as the room.

JSON Schemas for editors are in `schemas/`, generated from the same rules the server uses (`pnpm schemas` after changing `packages/shared/src/packs.ts`; a test fails if they are stale). `tools/e2e/trivia.mjs` plays trivia and a pack upload in real browsers, like `rounds.mjs`.

### Theme packs

A theme changes how the game looks and sounds, and can bundle its own words and questions. It is a folder `packs/themes/<id>/` holding `theme.json` and the files it points to (`packs/themes/halloween/` is the built-in example), or the same files zipped with `theme.json` at the top, which the host uploads in the lobby. The host picks a theme (or Plain) in the lobby and every phone and TV applies it.

```json
{ "schemaVersion": 1, "type": "theme", "name": "Halloween",
  "words": [{ "text": "ghost" }],
  "style": { "colors": { "bg": "#0e0a14", "primary": "#ff7a1a" }, "font": "display",
             "background": "background.svg", "sounds": { "boo": "sounds/boo.wav" } } }
```

Styles are tokens only, so a theme can't run anything: colors (`bg`, `panel`, `panel2`, `text`, `muted`, `primary`, `accent`, `good`, `bad`; text must stay readable on the backgrounds), a font from a fixed list (`system`, `serif`, `rounded`, `mono`, `display`, `handwriting`), one background image (png, jpg, webp or svg up to 1 MB; an svg with scripts is refused), and sounds that replace the TV's cues (`grab`, `boo`, `point`, `steal`, `round`, `final`; wav, mp3 or ogg up to 300 KB). A zip may hold up to 24 files and 4 MB. No custom CSS or code is accepted, and a theme's words and questions count toward the game while it is picked. `tools/e2e/theme.mjs` checks themes in real browsers.

### Pack generator and checker

`.claude/skills/pack-generator/` is a Claude Code skill that makes packs for you: ask it for "a 90s pop word pack and 20 trivia questions" or "a Christmas theme". It writes lyric-friendly words, trivia with a source link for each question (it opens the source to fact-check the answer, and sets `"unconfirmed": true` on anything it couldn't confirm, which the lobby shows as a warning), and themes, then checks the result.

Check any pack yourself with the same rules the lobby uses:

```sh
pnpm packs:check packs/music-trivia.json packs/themes/halloween my-theme.zip
pnpm packs:check --require-sources packs/my-trivia.json   # every question needs a source or "unconfirmed": true
```

### Fill a room with bots

Test on one phone by letting scripted bots be the other players:

```sh
pnpm bots --room ABCD --count 3                    # join an existing room
pnpm bots --room ABCD --count 2 --behavior booer   # always boo
pnpm bots --create --count 4 --words 5 --rounds 3 --trivia  # bots host and play their own game
```

Behaviors: `normal`, `always-grab`, `never-grab`, `never-vote`, `random-votes`, `booer`, `hurrayer`, `disconnect-mid-song`. Add `--url` for a server that isn't on `localhost:3000`, and `--speed 0.2` to make the bots five times quicker.

## Layout

```
apps/server/      Socket.IO handling, rooms, timers, devices and speakers, MediaAdapter (LiveKit)
apps/web/         phone view and TV screen (Vite + React)
packages/shared/  types, Zod message schemas, default rules
packages/engine/  pure game logic: step(state, event, now) → { state, effects }
packs/            word and trivia packs (plain JSON; the file name is the pack id) and themes/<id>/ theme packs
schemas/          JSON Schemas for the pack files, generated
tools/bots/       scripted bot players
tools/check-pack.ts  the pack checker behind `pnpm packs:check`
.claude/skills/pack-generator/  Claude Code skill that generates and checks packs
tools/e2e/        real-browser audio and TV checks (Playwright + a local LiveKit)
docker/           compose file and Caddyfile
```

`packages/engine` imports nothing except `packages/shared`, and never touches timers or I/O (a test checks this). Every duration and point value is in `packages/shared/src/config.ts`. The tests run the engine on a fake clock, so no phones are needed to check a rule change. Whole games are written as readable scripts in `packages/engine/test/scenarios.test.ts`.
