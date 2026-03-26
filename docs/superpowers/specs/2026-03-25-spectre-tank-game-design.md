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

---

## Architecture

```
Browser (Canvas + Socket.io client)
        ↕  WebSocket
Node.js Server (game authority + Socket.io)
```

- The **server** owns all game state: tank positions, health, projectiles, scores. It runs the authoritative game loop at ~20 ticks/sec and broadcasts state to all clients.
- The **client** captures keyboard input, renders the raycasted view, and sends input state (keys held) to the server each frame. The server applies inputs, resolves collisions and hits, then broadcasts the updated game state.
- Single-player mode uses the same server; bots run server-side.

### File Structure

```
spectre-tank-game/
├── server.js            # Node.js game server (Express + Socket.io)
├── package.json
└── public/
    ├── index.html       # Lobby screen + game canvas
    ├── renderer.js      # Raycasting engine
    ├── game.js          # Client game loop + input handling
    └── network.js       # Socket.io client wrapper
```

---

## Rendering

- **Technique**: JavaScript raycasting on HTML5 Canvas — same approach as Wolfenstein 3D
- **Aesthetic**: Green wireframe lines on black background, faithful to the original Spectre
- **Projection**: First-person perspective from inside the tank (cockpit view)
- **What gets rendered**:
  - Wall slices (varying height/brightness by distance)
  - Enemy tanks as wireframe bounding boxes with gun barrel indicator
  - Projectiles as small wireframe diamonds

---

## HUD Layout

**Option C — View + Minimap:**

```
┌──────────────────────────┬──────┐
│                          │ MAP  │
│   3D Raycasted View      │      │
│        [crosshair]       │  ·   │
│                          │      │
├──────────────────────────┴──────┤
│ HP ████░░   SCORE: 0   AMMO: 8  │
└─────────────────────────────────┘
```

- Main area: first-person raycasted view with crosshair overlay
- Right panel: wireframe top-down minimap showing walls and player position/direction
- Bottom strip: health bar, score, ammo count

---

## Game Mechanics

### Movement & Controls
- **W / ↑** — move forward
- **S / ↓** — move backward
- **A / ←** — turn left
- **D / →** — turn right
- **Space** — fire projectile

### Combat
- Each tank starts with **100 HP**
- Each projectile hit deals **25 HP** damage
- At 0 HP, tank is destroyed and respawns at a random spawn point after a short delay (~2s)
- Projectiles travel in a straight line; destroyed on wall or tank contact

### Scoring
- **+1 kill** per tank destroyed
- **Win condition**: first player/bot to reach **10 kills**
- Score displayed live in HUD

### Bot AI (Single Player)
- Bots navigate the maze using waypoint-based pathfinding
- Behavior: roam map → detect player within sight radius → turn to face → shoot
- Simple and reactive — no complex planning

---

## Multiplayer

- **Scope**: Same local WiFi network only
- **Hosting**: One player runs `node server.js`. Terminal prints local IP. Other players open `http://<host-ip>:3000` in their browser — no install required on client machines.
- **Player limit**: 2–8 players
- **Lobby**: Pre-game screen where the host selects map and clicks "Start Game". Joining players see a waiting screen with the live player list.
- **State sync**: Server runs authoritative game loop; clients send input state; server broadcasts game state to all clients at ~20 ticks/sec.
- **Disconnect handling**: Dropped players are removed from the game; match continues.

---

## Maps

Three selectable arenas. Host picks one from the lobby before the game starts.

| Map | Style | Description |
|-----|-------|-------------|
| **A — Symmetric Maze** | Mirrored corridors | Balanced for competitive play |
| **B — Open Arena** | Large open space + pillar clusters | Fast, chaotic fights |
| **C — Rooms + Corridors** | Distinct rooms connected by narrow hallways | Ambush-friendly |

All maps are grid-based (16×16 cells). Walls block movement and raycasting. Spawn points are distributed around the map perimeter and interior.

---

## Out of Scope

- Internet/WAN multiplayer (local WiFi only)
- Account system or persistent stats
- Sound effects / music (can be added later)
- Mobile/touch controls
- Multiple simultaneous games on one server
