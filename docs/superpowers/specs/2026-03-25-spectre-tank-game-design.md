# Spectre Tank Game — Design Spec

**Date**: 2026-03-25
**Status**: Approved

---

## Overview

A browser-based tank combat game inspired by the classic 1991 Mac game *Spectre*. Players drive tanks through wireframe 3D mazes in a first-person cockpit view, fighting bots or other players on the same local network.

---

## Stack

- **Server**: Node.js + Express + Socket.io
- **Client**: Vanilla JavaScript + HTML5 Canvas
- **No build step** — static files served directly by the Node.js server
- **Port**: 3000

---

## Architecture

```
Browser (Canvas + Socket.io client)
        ↕  WebSocket (port 3000)
Node.js Server (game authority + Socket.io)
```

- The **server** owns all game state: tank positions, health, projectiles, scores. It runs the authoritative game loop at 20 ticks/sec (50ms interval) and broadcasts state to all clients.
- The **client** captures keyboard input, renders the view, and sends input state (keys currently held) to the server each frame. The server applies inputs, resolves collisions and hits, then broadcasts the updated game state.
- Single-player mode uses the same server; bots run server-side alongside human players.

### File Structure

```
spectre-tank-game/
├── server.js            # Node.js game server (Express + Socket.io)
├── package.json
└── public/
    ├── index.html       # Lobby screen + game canvas
    ├── renderer.js      # Raycasting + sprite rendering engine
    ├── game.js          # Client game loop + input handling
    └── network.js       # Socket.io client wrapper
```

---

## World / Coordinate System

- The map is a **16×16 grid** of cells
- Each cell is **64 world units** wide and tall
- Total world size: 1024 × 1024 world units
- Tanks exist at sub-cell precision (floating-point x, y position + angle in radians)
- The raycaster operates in world units

---

## Rendering

### Approach: Raycasting with Wireframe Overlay

Standard raycasting (Wolfenstein-style) is used to determine wall distances per column. Walls are rendered as **outlined rectangles** (top edge, bottom edge, left/right edges at cell transitions) rather than solid filled columns, producing a wireframe appearance:

- **FOV**: 66° horizontal field of view
- Cast one ray per canvas column (320 rays for 320px wide view), spread evenly across the FOV
- For each ray, determine the hit distance and which face of the wall was hit (DDA algorithm)
- Draw the **top and bottom horizontal lines** of the wall slice for that column
- Draw **vertical edge lines** only where adjacent columns hit different wall faces (i.e., at corners)
- Result: walls appear as green line outlines, not solid fills

### Color Palette

- Background (floor/ceiling): `#000000`
- Walls: `#00ff00` at full brightness for near surfaces, fading to `rgba(0,255,0,0.2)` at max render distance (8 cells)
- Enemy tanks: `#00ff00` at 90% opacity
- Projectiles: `#00ff00` at 70% opacity
- HUD elements: `#00ff00`

### Enemy Tank Sprites

Tanks are rendered as **billboarded wireframe boxes** (always face the camera):
- Width and height scale inversely with distance
- At 1 cell distance: ~80px tall on a 320px high canvas
- Box represents the tank body; a single line extends upward from the center top to represent the gun barrel (25% of body height)
- Rendered using standard raycaster sprite projection

### Projectile Sprites

- Rendered as a small wireframe diamond (rotated square), ~6×6px at 1 cell distance
- Scale with distance same as tank sprites

### Canvas Resolution

- Raycasting canvas: **320×240** (upscaled 2× via CSS to 640×480 for display)
- Low resolution is intentional — matches the retro aesthetic

---

## HUD Layout

```
┌──────────────────────────────────┬──────┐
│                                  │ MAP  │
│   3D Raycasted View (320×240)    │      │
│          [crosshair +]           │  ·↑  │
│                                  │      │
├──────────────────────────────────┴──────┤
│ HP ████░░░░   SCORE: 0   AMMO: ∞        │
└─────────────────────────────────────────┘
```

- **Main area**: raycasted first-person view, upscaled via CSS
- **Crosshair**: static `+` drawn at center of view in green
- **Right panel**: top-down wireframe minimap (128×128px), shows walls as lines, player as a green dot with a direction indicator line, other tanks as smaller dots
- **Bottom strip**: health bar (block characters), score (integer), ammo (always `∞` — ammo is infinite)

---

## Game Mechanics

### Movement & Controls

| Key | Action |
|-----|--------|
| W / ↑ | Move forward |
| S / ↓ | Move backward |
| A / ← | Turn left |
| D / → | Turn right |
| Space | Fire projectile |

### Physics Values (server-side, applied per tick at 20 ticks/sec)

| Parameter | Value |
|-----------|-------|
| Move speed | 80 world units/sec (4 units/tick) |
| Turn speed | 120°/sec (6°/tick) |
| Projectile speed | 400 world units/sec (20 units/tick) |
| Projectile max range | 512 world units (8 cells) |
| Tank collision radius | 16 world units |
| Shoot cooldown | 500ms (10 ticks) — applies to both players and bots |

### Combat

- Each tank starts with **100 HP**
- Each projectile hit deals **25 HP** damage (4 hits to kill)
- At 0 HP: tank is destroyed, respawns at a random unoccupied spawn point after **2 seconds**
- Projectiles are destroyed on contact with a wall or tank
- A tank cannot be hit by its own projectiles (owner immunity)
- **Ammo is infinite** — no reload mechanic

### Scoring & Win Condition

- **+1 kill** per enemy tank destroyed (last hit attribution)
- **Win**: first player or bot to reach **10 kills**
- On win: server broadcasts a `game-over` event with the winner's name; all clients show a winner screen for 5 seconds, then return all players to the lobby

---

## Bot AI (Single Player)

- **Count**: 3 bots by default in single-player mode
- **Multiplayer bot fill**: bots fill slots so the total tank count (humans + bots) is always at least 4. Host can override by starting early.
- **Pathfinding**: waypoints are auto-generated at server startup by placing a node at the center of every non-wall cell. Bots navigate by picking a random adjacent waypoint and moving toward it (simple graph traversal, no A*).
- **Bot logic runs every tick** (20/sec), same as player physics. To prevent trivial lock-on, bot turn speed is capped at 6°/tick (same as player) — bots cannot instantly face a target.
- **State machine**:
  1. **Roam**: move toward next random adjacent waypoint
  2. **Engage**: if any human player is within **6 cells** (384 world units) and LOS is clear → turn to face player and shoot. LOS uses the same DDA ray cast as the renderer; only wall cells (grid value 1) block LOS — other tanks do not.
  3. **Return to Roam**: if no player is in range for >2 seconds
- **Shoot cooldown**: 500ms — same as player

---

## Multiplayer

- **Scope**: Same local WiFi network only
- **Hosting**: One player runs `node server.js`. Terminal prints local IP and port (e.g., `http://192.168.1.42:3000`). Other players open that URL in their browser — no install required.
- **Player limit**: 2–8 human players
- **Bots fill remaining slots** up to a server-configured max (default: bots only present if fewer than 2 humans)

### Lobby Flow

1. First player to connect becomes **host**
2. All players see a lobby screen with the live player list
3. Host sees a map selector (A/B/C) and a **Start Game** button
4. Host can start with **1 human player** (bots fill in)
5. **Mid-game joins**: not supported — players who connect while a game is in progress see a "Game in progress, please wait" screen and join the next lobby
6. On game over, all players return to the lobby automatically

### Player Identity

- On first connection, the client prompts for a name (text input on the lobby screen, 1–16 non-whitespace chars)
- Server enforces **unique names**: if a name is already taken, the server rejects the `join` and client shows an error prompting a different name
- Server assigns a unique `id` = socket ID
- Bots are named `Bot1`, `Bot2`, … `BotN` — generated sequentially based on how many bots are needed (always starting from 1)

### State Sync Protocol (Socket.io events)

| Event | Direction | Payload |
|-------|-----------|---------|
| `join` | Client → Server | `{ name: string }` |
| `input` | Client → Server | `{ keys: { w: bool, a: bool, s: bool, d: bool, space: bool } }` |
| `game-state` | Server → Client | `{ tanks: Tank[], projectiles: Projectile[], scores: Record<id,number> }` |
| `game-over` | Server → Client | `{ winner: string }` — winner is the player name |
| `lobby-state` | Server → Client | `{ players: Player[], hostId: string }` |
| `start-game` | Client → Server | `{ map: 'A' \| 'B' \| 'C' }` (host only) |

**Object schemas:**

```ts
// Player (in lobby-state)
{ id: string, name: string }

// Tank (in game-state)
{ id: string, name: string, x: number, y: number, angle: number, hp: number, isBot: boolean }

// Projectile (in game-state)
{ id: number, ownerId: string, x: number, y: number, angle: number }
// id: server-assigned monotonically incrementing integer, resets each game
```

**Input handling**: the server stores the **last-received input state** per player and applies it on every tick. Multiple inputs arriving between ticks are collapsed to the most recent; no accumulation.

**`game-over` winner field**: the `winner` field is the player's **name** (unique by server enforcement, so unambiguous). Bots can win.

**`start-game` enforcement**: server checks that the sending socket ID matches `hostId` before processing; non-host start requests are silently ignored.

**`scores` field**: cumulative kill count per player/bot ID (integer, reset to 0 at game start).

- **Disconnect**: player's tank removed immediately; game continues; if host disconnects, the next player in FIFO join order becomes host

### Mid-Game Join & Lobby Reconvening

- Players who connect during an active game see a "Game in progress — please wait" screen
- They receive **no `game-state` events** — only a `waiting` status event. `game-state` is broadcast only to active in-game players.
- They are held in a separate **waiting queue** (FIFO by connect time)
- **Host succession** draws only from the **active player list** (never from the waiting queue). If the host disconnects mid-game, the next active player in original join order becomes host.
- When the game ends, all active players and waiting players merge into a single lobby. The original host retains host status if still connected; otherwise the first active player in FIFO join order becomes host. Waiting players join behind active players in FIFO order.

---

## Maps

Three selectable grid-based arenas (16×16 cells, 64 units/cell). Host picks from lobby.

| Map | Style | Feel |
|-----|-------|------|
| **A — Symmetric Maze** | Mirrored corridors | Balanced competitive |
| **B — Open Arena** | Large open space + 2×2 pillar clusters | Fast, chaotic |
| **C — Rooms + Corridors** | 3–4 distinct rooms + narrow hallways | Ambush-friendly |

### Map Data Format

Maps are defined in `server.js` as JavaScript objects:

```js
{
  grid: number[][],   // 16×16 array; 0 = open floor, 1 = wall
  spawns: [number, number][]  // array of [col, row] spawn points (8 per map)
}
```

Example cell at column 3, row 2: `grid[2][3]`

Spawn point coordinates are in **grid cells** (not world units). Server converts to world units by multiplying by 64 and adding 32 (cell center).

**Spawn selection**: on spawn/respawn, server picks the spawn point (converted to world coords) that maximizes the minimum distance to any currently living enemy tank. To prevent concurrent collisions (multiple tanks respawning simultaneously to the same point), spawn points are **reserved** for 2 seconds once selected — reserved points are excluded from selection. If all 8 spawn points are reserved, pick the one whose reservation expires soonest.

### Minimap rendering

The minimap draws walls as filled 1px green rectangles per wall cell, scaled to fit the 128×128 minimap panel. Player is a green dot with a short direction line; other tanks are 2px dots.

---

## Out of Scope

- Internet/WAN multiplayer (local WiFi only)
- Account system or persistent stats
- Sound effects or music
- Mobile/touch controls
- Multiple simultaneous game rooms on one server
