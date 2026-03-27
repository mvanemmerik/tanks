# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # Start the game server on port 3000
npm test               # Run all tests
npm test -- tests/physics.test.js   # Run a single test file
npm test -- --testNamePattern="castLosRay"  # Run tests matching a name
```

## Deployment

The live game runs at **tanks.vanemmerik.ai** on AWS EC2 (us-east-1, t3.micro) behind Cloudflare (Full SSL mode, Origin Certificate).

To deploy changes:
```bash
# On EC2 (ssh ubuntu@<elastic-ip>)
cd ~/tanks
git pull
pm2 restart game
```

PM2 process name is `game`. Nginx proxies port 80/443 → 3000 with WebSocket upgrade headers.

## Architecture

**Server-authoritative**: The server owns all game state and runs the game loop at 20 ticks/sec (50ms). Clients send input state each tick; the server applies physics, resolves collisions, and broadcasts the full game state. No client-side prediction.

```
Browser (Canvas + Socket.io client)
        ↕  WebSocket (port 3000)
Node.js Server (game authority + Socket.io)
```

**Server modules** (Node.js, all `require`-based):
- `server.js` — Express static serving, Socket.io multi-room management, `gameTick` loop. Uses `rooms` Map (roomCode → Room) and `socketToRoom` Map (socket.id → roomCode).
- `maps.js` — Static map data (`MAPS` object: keys `'A'`/`'B'`/`'C'`, each with `grid: number[][]` and `spawns: [col,row][]`)
- `physics.js` — Pure functions: `isWall`, `isPositionValid`, `applyMovement` (axis-separated wall sliding), `applyTurn`, `castLosRay` (DDA), `distanceBetween`
- `game-state.js` — Tank/projectile/score lifecycle; `createGameState`, `spawnTank` (spawn reservation system), `addKill`, `checkWinCondition`, `createProjectile`
- `bot-ai.js` — `generateWaypoints`, `tickBot` (mutates bot tank's `inputKeys` and `angle` only — movement is applied by `gameTick`, not here)

**Client files** (browser globals, loaded via `<script>` tags in order):
1. `/socket.io/socket.io.js` (served by Socket.io automatically)
2. `public/network.js` → exposes `Network` global
3. `public/renderer.js` → exposes `Renderer` global
4. `public/sound.js` → exposes `Sound` global (Web Audio API, procedural synthesis)
5. `public/game.js` → exposes `Game` global
6. Inline script in `public/index.html` wires everything together

## Key Design Decisions

**World coordinates**: 16×16 grid, each cell = 64 world units. Tanks exist at floating-point positions. `CELL_SIZE=64`, `TANK_RADIUS=16`.

**Physics values** (applied per tick at 20/sec):
- Move: 4 units/tick, Turn: π/30 rad/tick (6°), Projectile: 20 units/tick
- Max projectile range: 512 units (8 cells), Shoot cooldown: 500ms
- Tank HP: 100, damage per hit: 25, respawn delay: 2s

**Multi-room server**: Each room is an object `{ code, isPublic, lobby: { players, hostId }, gameState, gamePhase, gameLoopInterval, waypoints, nextBotNum }`. `rooms` Map (roomCode → Room) and `socketToRoom` Map (socket.id → roomCode) are the two module-level state structures. `_resetForTesting()` clears both. `startGame(mapKey, room)` and `gameTick(room)` are parameterized per room. `broadcastGameList()` sends all clients `[{ roomCode, playerCount, isPublic }]` for rooms where `isPublic && gamePhase === 'lobby'`.

**Bot AI contract**: `tickBot` sets `bot.inputKeys` (and `bot.angle` for turning) but does **not** call `applyMovement` or update `bot.lastShot`. The server's `gameTick` loop applies movement and owns `lastShot` updates for all tanks uniformly. Breaking the movement rule causes double speed; setting `lastShot` in `tickBot` prevents bots from ever firing (cooldown check fails immediately).

**Bot AI behavior**: Bots roam to random waypoints until a human is within `ENGAGE_RANGE = 8 * CELL_SIZE` (512 units) with line-of-sight. In engage state: turns to face target, advances forward when within 60° of target and target is >2 cells away, shoots when within 30° and cooldown expired. Returns to roam after 2s without a visible target.

**Spawn reservation**: When a tank spawns, its spawn point is reserved for 2 seconds to prevent concurrent respawn collisions. `selectSpawnPoint` picks the available point farthest from all living enemies; falls back to soonest-expiring reservation if all 8 are reserved.

**`game-over` winner field**: The server emits the winner's **name string** (not socket ID). `checkWinCondition` returns `gs.playerNames.get(id)` — names are stored in a separate `playerNames` Map that persists across death, so the win check works even when the winner's tank is currently dead.

**Input normalization**: Server's `input` handler accepts both `{ w, a, s, d, space }` (flat, what the client sends) and `{ keys: { w, a, s, d, space } }` (nested) via `payload.keys ?? payload`.

**Test isolation**: `server.js` exports `_resetForTesting()` which clears all module-level mutable state (`rooms`, `socketToRoom`, `gamePhase`, `gameLoopInterval`). The server test file calls it in `beforeEach`. Tests also import `io` and call `io.disconnectSockets()` in `afterAll` to allow the server to close cleanly within Jest's 5s timeout.

**Test timing — setImmediate vs I/O phase**: On connect, the server calls `setImmediate(() => broadcastGameList())`. `setImmediate` fires in the CHECK phase, which runs *before* the subsequent I/O phase where the client's `connect` event fires. This means any broadcast triggered by `connect` (via setImmediate) arrives *after* the client's `connect` callback — the client listener is attached in time. Tests that depend on `broadcastGameList` must attach the listener first, *then* trigger the action (e.g. `createRoom`) that causes the subsequent broadcast.

**Canvas resolution**: Game canvas renders natively at 640×480 (`CANVAS_W=640`, `CANVAS_H=480` in `renderer.js`). The HTML `width`/`height` attributes, CSS `width`/`height`, and `CANVAS_W`/`CANVAS_H` constants must all agree. If `CANVAS_W`/`CANVAS_H` are smaller than the HTML buffer size, rendering appears only in the upper-left corner of the canvas.

**Sound**: All sound effects are procedurally synthesized via the Web Audio API in `public/sound.js` — no audio files. Client-side shoot feedback plays immediately on keydown (with a local 500ms cooldown) rather than waiting for server round-trip. Enemy shoot and hit/explode sounds are triggered from game-state diffs in `game.js`.

**Win condition**: First player to reach `WIN_KILLS = 10` kills ends the round (defined in `game-state.js`).

**No build step**: Static files in `public/` are served directly. No bundler, no transpilation.

## Socket.io Events

| Event | Direction | Key payload fields |
|-------|-----------|-------------------|
| `create-room` | Client→Server | `{ name, isPublic }` |
| `join-room` | Client→Server | `{ roomCode, name }` |
| `start-game` | Client→Server | `{ map: 'A'\|'B'\|'C' }` (host only) |
| `input` | Client→Server | `{ w, a, s, d, space }` (booleans) |
| `room-created` | Server→Client | `{ roomCode }` |
| `room-error` | Server→Client | `{ message }` |
| `name-error` | Server→Client | `{ message }` |
| `game-list` | Server→Client | `[{ roomCode, playerCount, isPublic }]` — broadcast to all on change |
| `lobby-state` | Server→Client | `{ players: [{id,name}], hostId }` |
| `game-start` | Server→Client | `{}` — signals game beginning |
| `game-state` | Server→Client | `{ tanks, projectiles, scores }` |
| `game-over` | Server→Client | `{ winner }` — name string |
| `map-data` | Server→Client | `{ grid }` — sent once on game start |

Tank schema in `game-state`: `{ id, name, x, y, angle, hp, isBot }`.
Projectile schema: `{ id, ownerId, x, y, angle }`.
