# Hot Mic

A self-hosted online party game, Pass The Mic meets Kahoot. A word appears, everyone races to grab the mic, and the winner has to sing a song containing that word. Everyone else votes Boo or Hurray.

The design doc and the build plan are the source of truth; this README only covers running and developing the code.

**Status: Milestone 1 (core loop, phones only).** There is no audio yet, so play it over a video call. Built-in audio is Milestone 2.

## Play it

You need Node 20+ and [pnpm](https://pnpm.io) (`corepack enable` is enough).

```sh
pnpm install
pnpm build        # builds the web app
pnpm start        # http://localhost:3000
```

Open it on a phone, create a room, and share the code or the invite link. Everyone picks or creates a household (everyone under one roof shares one).

Mic access needs HTTPS on a real phone, so for anything beyond localhost use Docker below.

### Docker Compose (HTTPS)

```sh
docker compose up --build
```

This runs the game server behind Caddy, which handles HTTPS automatically. With nothing set you get `https://localhost` using Caddy's local CA (run `docker compose exec caddy caddy trust` once, or accept the browser warning). For a real certificate point a domain at the machine, open ports 80 and 443, and put `DOMAIN=hotmic.example.com` in a `.env` file (see `.env.example`).

### Develop

```sh
pnpm dev          # game server on :3000 + Vite on :5173 (proxied), with reload
pnpm test         # engine tests, scripted games, server + bots integration
pnpm typecheck
```

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
apps/server/      Socket.IO handling, rooms, timers, MediaAdapter (no-op until Milestone 2)
apps/web/         phone view (Vite + React)
packages/shared/  types, Zod message schemas, default rules
packages/engine/  pure game logic: step(state, event, now) → { state, effects }
packs/            word packs (plain JSON); the file name is the pack id
tools/bots/       scripted bot players
docker/           compose file and Caddyfile
```

`packages/engine` imports nothing except `packages/shared`, and never touches timers or I/O (a test checks this). Every duration and point value is in `packages/shared/src/config.ts`. The tests run the engine on a fake clock, so no phones are needed to check a rule change. Whole games are written as readable scripts in `packages/engine/test/scenarios.test.ts`.
