# Spectre

A multiplayer tank combat game playable in the browser. First to 10 kills wins.

**Live:** https://tanks.vanemmerik.ai

---

## How to Play

- **W / S** — move forward / backward
- **A / D** — rotate left / right
- **Space** — fire

First player to 10 kills wins the round. The game returns to the lobby automatically so you can play again.

---

## Multiplayer

From the landing screen:

| Action | How |
|--------|-----|
| Create a public game | Enter your name → **CREATE PUBLIC GAME** — room appears in Browse Games |
| Create a private game | Enter your name → **CREATE PRIVATE GAME** — share the 6-letter room code with friends |
| Join a public game | **BROWSE GAMES** → click Join next to any open room |
| Join by code | Enter the room code in the ROOM CODE field → **JOIN** |

Up to 4 players per room. If there are fewer than 4 human players, bots fill the remaining slots.

---

## Running Locally

```bash
npm install
npm start        # starts server at http://localhost:3000
npm test         # run all tests
```

Node.js 18+ required.

---

## Architecture

Server-authoritative at 20 ticks/sec. Clients send key state each tick; the server runs physics, resolves collisions, and broadcasts full game state.

```
Browser (Canvas + Socket.io client)
        ↕  WebSocket
Node.js server (game authority)
```

**Server modules:** `server.js`, `game-state.js`, `physics.js`, `bot-ai.js`, `maps.js`

**Client files** (no build step): `network.js`, `renderer.js`, `sound.js`, `game.js`

Sound effects are procedurally synthesized via the Web Audio API — no audio files.

---

## Stack

- Node.js + Express + Socket.io
- HTML5 Canvas (raycasting renderer)
- Jest (70 tests)
- AWS EC2 t3.micro + nginx + PM2
- Cloudflare (DNS + SSL)
