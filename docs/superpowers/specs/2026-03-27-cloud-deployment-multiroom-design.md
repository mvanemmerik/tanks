# Cloud Deployment + Multi-Room Design

**Date:** 2026-03-27
**Repo:** git@github.com:mvanemmerik/tanks.git
**Domain:** tanks.vanemmerik.ai (Cloudflare free)
**Status:** Approved

---

## Overview

Deploy the tank game to AWS so any player can open `tanks.vanemmerik.ai`, create their own game room or browse and join an existing one. The current single-lobby, single-game model is extended to support multiple concurrent game rooms. Scale target is small/hobby — a handful of concurrent games, ~20–50 players total.

---

## AWS Infrastructure

| Component | Choice | Notes |
|-----------|--------|-------|
| Compute | EC2 t3.micro | ~$8/mo, plenty for hobby scale |
| IP | Elastic IP | Stable address across reboots, ~$0 while attached |
| OS | Ubuntu 22.04 LTS | |
| Region | us-east-1 | |
| Security Group | Ports 22, 80, 443 inbound | Node on :3000 is internal only |
| Reverse proxy | nginx | SSL termination + WebSocket upgrade headers |
| SSL (origin) | Cloudflare Origin Certificate | Free, 15-year validity, no Certbot/renewal needed |
| Process manager | PM2 | Auto-restart on crash, starts on boot |

**Estimated cost:** ~$8–10/month (EC2 + Elastic IP; Cloudflare is free).

---

## Cloudflare Configuration

- DNS: A record `tanks` → Elastic IP, **Proxied** (orange cloud)
- SSL/TLS mode: **Full** (not Flexible, not Full Strict)
- **Origin Certificate** (not Let's Encrypt): generate a Cloudflare Origin Certificate in the Cloudflare dashboard (SSL/TLS → Origin Server → Create Certificate). Install the cert and key on the EC2 instance. Valid for 15 years, no renewal, no Certbot. Works only when Cloudflare is proxying — which it always is in this setup.
  - Cloudflare handles browser↔CF encryption (using Cloudflare's managed cert)
  - The Origin Certificate handles CF↔EC2 encryption
- Benefits at free tier: DDoS protection, CDN caching of static assets, free managed SSL toward browser

---

## nginx Configuration (key directives)

```nginx
server {
    listen 443 ssl;
    server_name tanks.vanemmerik.ai;

    # Cloudflare Origin Certificate (installed manually, no Certbot)
    ssl_certificate     /etc/ssl/cloudflare/tanks.vanemmerik.ai.pem;
    ssl_certificate_key /etc/ssl/cloudflare/tanks.vanemmerik.ai.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        # WebSocket upgrade headers (required for Socket.io)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 80;
    server_name tanks.vanemmerik.ai;
    return 301 https://$host$request_uri;
}
```

---

## Multi-Room Server Refactor

### Current state (single game)

`server.js` holds all game state as module-level globals:
```
lobby, gameState, gamePhase, gameLoopInterval, waypoints, nextBotNum
```
This supports exactly one lobby and one game at a time.

### Target state (multi-room)

All per-game state moves into a `Room` object. A top-level `rooms` Map replaces the globals.

```js
// Room structure
{
  code: 'ABC123',          // 6-char alphanumeric, used as Socket.io room name
  isPublic: true,
  lobby: { players: [], hostId: null },
  gameState: null,
  gamePhase: 'lobby',      // 'lobby' | 'playing'
  gameLoopInterval: null,
  waypoints: [],
  nextBotNum: 1,
}

const rooms = new Map(); // code → Room
```

**Room code generation:** 6 random uppercase alphanumeric characters, collision-checked against `rooms`.

**Socket.io scoping:** Each socket joins the Socket.io room named after the room code (`socket.join(room.code)`). All existing broadcasts (`lobby-state`, `game-state`, `game-over`, etc.) use `io.to(room.code)` instead of `io.to('lobby')`.

**Game logic unchanged:** `gameTick`, physics, bot AI, `game-state.js`, `physics.js`, `bot-ai.js` are all untouched. They operate on a room's `gameState` instead of a module-level global.

**Bot count per room:** Bots fill to `MIN_TOTAL_TANKS = 4` (same as current). If there are 3 human players, 1 bot is added; if 4+, no bots. Not host-configurable. Each room's `nextBotNum` counter starts at 1 and increments per bot spawned.

**Room cleanup:** A room is deleted from `rooms` and its game loop cleared when:
- All human players disconnect while the room is in `'lobby'` phase, OR
- All human players disconnect during an active game (only bots remain or room is empty) — the game loop is stopped immediately and the room is removed. Bots do not keep a room alive.

**`game-over` → Lobby transition:** When `checkWinCondition` returns a winner, the server emits `game-over` to the room, then resets the room's own state: `gameState = null`, `gamePhase = 'lobby'`, `gameLoopInterval` cleared, `nextBotNum` reset to 1. The room code persists. All sockets remain in the Socket.io room. The host remains the host (or is reassigned to the first remaining player if the host disconnected during the game). Players are returned to the lobby UI and can start a new game.

**Public game list:** Only rooms where `isPublic === true && gamePhase === 'lobby'` appear in the list. Rooms that are private, or are in `'playing'` phase, are excluded. The list is broadcast to all sockets not currently in a room whenever any room's state changes (created, player joins/leaves, game starts, room deleted).

---

## New Socket.io Events

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `create-room` | C→S | `{ name, isPublic }` | Create a new room; server responds with `room-created` |
| `room-created` | S→C | `{ roomCode }` | Sent to host after room is created |
| `join-room` | C→S | `{ roomCode, name }` | Join by code (works for public and private) |
| `room-error` | S→C | `{ message }` | Room not found, name taken, game already in progress |
| `game-list` | S→C | `[{ roomCode, playerCount, isPublic }]` | Live list of open public lobbies; pushed on any change |

### Unchanged events (scoped to room)

`lobby-state`, `start-game`, `input`, `game-state`, `map-data`, `game-over`, `name-error`

### Retired events

`waiting` — removed. The old single-game flow emitted `waiting` to players who connected while a game was in progress, queuing them. In multi-room, any player connecting always lands on the landing/browser screen and can create or join any open room. There is no queue concept.

---

## Client Changes

### New screens (index.html / game.js)

1. **Landing screen** — enter display name → three buttons: "Browse Games", "Create Game", "Join with Code"
2. **Game browser** — live-updating list of public open lobbies with player count and a Join button; refreshed via `game-list` event
3. **Create room modal** — toggle public/private; submit calls `create-room`
4. **Join with code** — text input for 6-char code; submit calls `join-room`

### Unchanged screens

Lobby UI, game canvas, HUD, renderer, minimap, sound — all unchanged.

### Room code display

In the lobby screen, show the room code prominently so the host can share it with friends (relevant for both private rooms and public rooms where players want to invite someone directly).

---

## Player Flow

```
Connect → Landing screen
  ├─ Browse Games → game-list → click Join → join-room → Lobby
  ├─ Create Game → create-room → room-created → Lobby (as host)
  └─ Join with Code → join-room → Lobby

Lobby → host starts → Game → game-over → Lobby (same room)
  └─ Any player can leave → Landing screen
```

---

## Deployment Workflow

### One-time AWS setup

1. Launch EC2 t3.micro (Ubuntu 22.04, us-east-1), attach Elastic IP
2. Security Group: inbound 22, 80, 443
3. SSH in: install Node.js 20 LTS, PM2, nginx
4. `git clone git@github.com:mvanemmerik/tanks.git`
5. `npm install --production`
6. `pm2 start server.js --name game && pm2 save && pm2 startup`
7. Configure nginx (see above)

### One-time Cloudflare setup

1. Add/confirm vanemmerik.ai on Cloudflare; update registrar nameservers if needed
2. DNS → Add A record: `tanks` → Elastic IP, Proxied (orange cloud)
3. SSL/TLS → Overview → set to **Full**
4. SSL/TLS → Origin Server → Create Certificate → select 15-year validity → copy the certificate and key
5. On EC2: save cert to `/etc/ssl/cloudflare/tanks.vanemmerik.ai.pem` and key to `/etc/ssl/cloudflare/tanks.vanemmerik.ai.key` (chmod 600 the key), then `nginx -t && systemctl reload nginx`

### Ongoing deploys

```bash
ssh ubuntu@<elastic-ip>
cd ~/tanks
git pull
npm install --production
pm2 restart game
```

~30 seconds, ~2 seconds of downtime during restart.

---

## Future Considerations (out of scope now)

- **CI/CD:** GitHub Action to SSH + deploy on push to main
- **Static assets to S3/CloudFront:** if EC2 load becomes a concern
- **Persistence:** Room history or player stats via DynamoDB
- **Scaling:** Redis adapter for Socket.io + multiple EC2 instances behind an ALB with sticky sessions
