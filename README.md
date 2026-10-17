# Hot Mic

A self-hosted online party game, Pass The Mic meets Kahoot. A word appears, everyone races to grab the mic, and the winner has to sing a song containing that word. Everyone else votes Boo or Hurray.

The design doc and the build plan are the source of truth; this README only covers running and developing the code.

**Status: Milestone 3 (TV main screen).** The singer's voice reaches every other household through the app, and a TV can show the game. Without the audio server (see below) the game still runs and can be played over a video call.

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

### Fill a room with bots

Test on one phone by letting scripted bots be the other players:

```sh
pnpm bots --room ABCD --count 3                    # join an existing room
pnpm bots --room ABCD --count 2 --behavior booer   # always boo
pnpm bots --create --count 4 --words 5             # bots host and play their own game
```

Behaviors: `normal`, `always-grab`, `never-grab`, `never-vote`, `random-votes`, `booer`, `hurrayer`, `disconnect-mid-song`. Add `--url` for a server that isn't on `localhost:3000`, and `--speed 0.2` to make the bots five times quicker.

## Layout

```
apps/server/      Socket.IO handling, rooms, timers, devices and speakers, MediaAdapter (LiveKit)
apps/web/         phone view and TV screen (Vite + React)
packages/shared/  types, Zod message schemas, default rules
packages/engine/  pure game logic: step(state, event, now) → { state, effects }
packs/            word packs (plain JSON); the file name is the pack id
tools/bots/       scripted bot players
tools/e2e/        real-browser audio and TV checks (Playwright + a local LiveKit)
docker/           compose file and Caddyfile
```

`packages/engine` imports nothing except `packages/shared`, and never touches timers or I/O (a test checks this). Every duration and point value is in `packages/shared/src/config.ts`. The tests run the engine on a fake clock, so no phones are needed to check a rule change. Whole games are written as readable scripts in `packages/engine/test/scenarios.test.ts`.
