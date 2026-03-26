# Spectre Tank Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-based wireframe tank game inspired by Spectre (1991), with raycasting 3D rendering, bot AI, and same-WiFi multiplayer via Node.js/Socket.io.

**Architecture:** The Node.js server owns all game state and runs an authoritative 20 ticks/sec game loop. Clients send input state each frame; the server applies physics, resolves combat, and broadcasts game state to all active players. The browser renders the scene using a raycasting engine on HTML5 Canvas with a wireframe aesthetic. No build step — static files served directly by the Express server.

**Tech Stack:** Node.js + Express + Socket.io (server); Vanilla JS + HTML5 Canvas + Socket.io client (browser); Jest + socket.io-client (testing)

---

## File Map

| File | Responsibility |
|------|---------------|
| `server.js` | Express server, Socket.io setup, lobby management, game loop orchestration |
| `maps.js` | Static map data: grid arrays, spawn points for all 3 arenas |
| `physics.js` | Pure movement, wall collision, tank-tank collision, LOS ray cast |
| `game-state.js` | Tank/projectile/score lifecycle, spawn selection with reservations |
| `bot-ai.js` | Waypoint generation, bot state machine, per-tick bot updates |
| `public/index.html` | Lobby UI, player name entry, map selector, game canvas + HUD |
| `public/network.js` | Socket.io client wrapper; emits input, receives game-state |
| `public/renderer.js` | DDA raycasting, wireframe wall rendering, sprite projection, minimap |
| `public/game.js` | Client game loop, keyboard input, calls renderer, drives network |
| `tests/maps.test.js` | Map format validation |
| `tests/physics.test.js` | Movement, collision, LOS |
| `tests/game-state.test.js` | Spawn selection, scoring, win detection |
| `tests/bot-ai.test.js` | Waypoint generation, state machine transitions |
| `tests/server.test.js` | Socket.io integration: join, lobby, start-game, disconnect |

---

## Constants (shared across modules)

```js
// Used in both physics.js and renderer.js (duplicated — no shared bundle)
const CELL_SIZE = 64;        // world units per grid cell
const GRID_SIZE = 16;        // cells per axis
const WORLD_SIZE = 1024;     // CELL_SIZE * GRID_SIZE
const TANK_RADIUS = 16;      // collision radius in world units
const MOVE_SPEED = 4;        // world units per tick
const TURN_SPEED = Math.PI / 30;  // 6 degrees in radians per tick
const PROJECTILE_SPEED = 20; // world units per tick
const PROJECTILE_MAX_RANGE = 512; // world units
const SHOOT_COOLDOWN = 500;  // ms
const TICK_RATE = 20;        // ticks per second
const TICK_MS = 1000 / TICK_RATE;
const MAX_HP = 100;
const DAMAGE = 25;
const RESPAWN_DELAY = 2000;  // ms
const WIN_KILLS = 10;
const FOV = 66 * Math.PI / 180;  // radians
const CANVAS_W = 320;
const CANVAS_H = 240;
const MAX_RENDER_DIST = 8 * CELL_SIZE; // 512 world units
```

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `server.js`
- Create: `public/index.html`
- Create: `tests/server.test.js` (scaffold)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "spectre-tank-game",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "jest --testEnvironment node"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.6.1"
  },
  "devDependencies": {
    "jest": "^29.5.0",
    "socket.io-client": "^4.6.1"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd /Users/monty/Desktop/Claude/projects/spectre-tank-game
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 3: Write the failing test**

`tests/server.test.js`:
```js
const http = require('http');

test('server returns 200 for GET /', (done) => {
  const req = http.get('http://localhost:3000/', (res) => {
    expect(res.statusCode).toBe(200);
    done();
  });
  req.on('error', done);
});
```

- [ ] **Step 4: Verify test fails (server not running yet)**

```bash
npm test -- tests/server.test.js
```

Expected: FAIL — connection refused.

- [ ] **Step 5: Create server.js scaffold**

```js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.listen(PORT, () => {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    let localIp = 'localhost';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          localIp = net.address;
          break;
        }
      }
    }
    console.log(`Spectre Tank Game running at http://${localIp}:${PORT}`);
    console.log(`Local:   http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io };
```

- [ ] **Step 6: Create public/index.html placeholder**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Spectre Tank Game</title>
</head>
<body>
  <h1>Spectre Tank Game</h1>
</body>
</html>
```

- [ ] **Step 7: Run test with server started**

In one terminal: `node server.js`
In another: `npm test -- tests/server.test.js`

Expected: PASS — `server returns 200 for GET /`

- [ ] **Step 8: Stop test server, commit**

```bash
git add package.json package-lock.json server.js public/index.html tests/server.test.js
git commit -m "chore: initial project scaffold with Express server and test harness"
```

---

## Task 2: Map Data

**Files:**
- Create: `maps.js`
- Create: `tests/maps.test.js`

- [ ] **Step 1: Write failing tests**

`tests/maps.test.js`:
```js
const { MAPS } = require('../maps');

describe('Map data format', () => {
  ['A', 'B', 'C'].forEach((key) => {
    describe(`Map ${key}`, () => {
      const map = MAPS[key];

      test('has a grid property', () => {
        expect(map.grid).toBeDefined();
      });

      test('grid is 16 rows', () => {
        expect(map.grid.length).toBe(16);
      });

      test('each row is 16 columns', () => {
        map.grid.forEach((row, i) => {
          expect(row.length).toBe(16);
        });
      });

      test('all cells are 0 or 1', () => {
        map.grid.forEach((row, r) => {
          row.forEach((cell, c) => {
            expect([0, 1]).toContain(cell);
          });
        });
      });

      test('border cells are all walls', () => {
        for (let i = 0; i < 16; i++) {
          expect(map.grid[0][i]).toBe(1);
          expect(map.grid[15][i]).toBe(1);
          expect(map.grid[i][0]).toBe(1);
          expect(map.grid[i][15]).toBe(1);
        }
      });

      test('has exactly 8 spawn points', () => {
        expect(map.spawns.length).toBe(8);
      });

      test('all spawn points are on open floor cells', () => {
        map.spawns.forEach(([col, row]) => {
          expect(map.grid[row][col]).toBe(0);
        });
      });

      test('all spawn points are within bounds', () => {
        map.spawns.forEach(([col, row]) => {
          expect(col).toBeGreaterThanOrEqual(1);
          expect(col).toBeLessThanOrEqual(14);
          expect(row).toBeGreaterThanOrEqual(1);
          expect(row).toBeLessThanOrEqual(14);
        });
      });
    });
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npm test -- tests/maps.test.js
```

Expected: FAIL — `Cannot find module '../maps'`

- [ ] **Step 3: Create maps.js**

```js
// Map grid: 0 = open floor, 1 = wall
// Spawn points: [col, row] in grid coordinates
// World coords: col * 64 + 32, row * 64 + 32 (cell center)

const MAPS = {
  // Map A: Symmetric Maze — mirrored corridors, balanced for competitive play
  A: {
    grid: [
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
      [1,0,1,0,0,0,1,0,0,1,0,0,0,1,0,1],
      [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
      [1,1,0,1,1,1,0,1,1,0,1,1,1,0,1,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,1,0,0,1,0,0,0,0,1,0,0,1,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,1,0,0,1,0,0,0,0,1,0,0,1,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,1,0,1,1,1,0,1,1,0,1,1,1,0,1,1],
      [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
      [1,0,1,0,0,0,1,0,0,1,0,0,0,1,0,1],
      [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    ],
    spawns: [
      [1,1],[14,1],[1,14],[14,14],
      [7,5],[8,5],[7,10],[8,10],
    ],
  },

  // Map B: Open Arena — large open space with 2x2 pillar clusters, fast fights
  B: {
    grid: [
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,1,1,0,0,0,0,0,0,1,1,0,0,1],
      [1,0,0,1,1,0,0,0,0,0,0,1,1,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,1,1,1,1,0,0,0,0,0,1],
      [1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1],
      [1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1],
      [1,0,0,0,0,0,1,1,1,1,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,1,1,0,0,0,0,0,0,1,1,0,0,1],
      [1,0,0,1,1,0,0,0,0,0,0,1,1,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    ],
    spawns: [
      [1,1],[14,1],[1,14],[14,14],
      [1,7],[14,7],[7,1],[7,14],
    ],
  },

  // Map C: Rooms + Corridors — distinct rooms linked by narrow hallways, ambush-friendly
  C: {
    grid: [
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
      [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
      [1,1,0,1,1,1,1,0,0,1,1,1,1,0,1,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,1,0,1,1,1,1,0,0,1,1,1,1,0,1,1],
      [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
      [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    ],
    spawns: [
      [1,1],[14,1],[1,14],[14,14],
      [6,3],[9,3],[6,12],[9,12],
    ],
  },
};

module.exports = { MAPS };
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/maps.test.js
```

Expected: All 24 tests PASS (8 per map x 3 maps).

- [ ] **Step 5: Commit**

```bash
git add maps.js tests/maps.test.js
git commit -m "feat: add map data for three arenas with format validation tests"
```

---

## Task 3: Physics Module

**Files:**
- Create: `physics.js`
- Create: `tests/physics.test.js`

- [ ] **Step 1: Write failing tests**

`tests/physics.test.js`:
```js
const {
  isWall, isPositionValid, applyMovement, applyTurn,
  castLosRay, distanceBetween,
} = require('../physics');

// Minimal 4x4 test grid: 0=floor, 1=wall
const GRID = [
  [1,1,1,1],
  [1,0,0,1],
  [1,0,0,1],
  [1,1,1,1],
];

describe('isWall', () => {
  test('wall cell returns true', () => {
    expect(isWall(0, 0, GRID)).toBe(true);
    expect(isWall(0, 32, GRID)).toBe(true);
  });

  test('open cell returns false', () => {
    expect(isWall(96, 96, GRID)).toBe(false);
  });

  test('out of bounds returns true', () => {
    expect(isWall(-1, 96, GRID)).toBe(true);
    expect(isWall(96, -1, GRID)).toBe(true);
    expect(isWall(999, 96, GRID)).toBe(true);
  });
});

describe('isPositionValid', () => {
  const R = 16;

  test('tank center in open area is valid', () => {
    expect(isPositionValid(96, 96, R, GRID)).toBe(true);
  });

  test('tank touching left wall is invalid', () => {
    expect(isPositionValid(64 + R - 1, 96, R, GRID)).toBe(false);
  });

  test('tank center far from walls is valid', () => {
    expect(isPositionValid(128, 128, R, GRID)).toBe(true);
  });
});

describe('applyMovement', () => {
  test('moves forward in open space', () => {
    const result = applyMovement(96, 96, 0, 4, GRID);
    expect(result.x).toBeCloseTo(100, 1);
    expect(result.y).toBeCloseTo(96, 1);
  });

  test('blocked by wall — does not move through it', () => {
    const result = applyMovement(190, 96, 0, 20, GRID);
    expect(result.x).toBeLessThan(200);
  });
});

describe('applyTurn', () => {
  test('turn right increases angle', () => {
    const a = applyTurn(0, Math.PI / 30);
    expect(a).toBeCloseTo(Math.PI / 30, 5);
  });

  test('angle wraps around 2pi', () => {
    const a = applyTurn(Math.PI * 2 - 0.01, 0.05);
    expect(a).toBeCloseTo(0.04, 2);
  });
});

describe('castLosRay', () => {
  test('returns true when path is clear', () => {
    expect(castLosRay(80, 80, 160, 160, GRID)).toBe(true);
  });

  test('returns false when wall is in the way', () => {
    expect(castLosRay(96, 96, 300, 96, GRID)).toBe(false);
  });
});

describe('distanceBetween', () => {
  test('calculates Euclidean distance', () => {
    expect(distanceBetween(0, 0, 3, 4)).toBeCloseTo(5, 5);
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npm test -- tests/physics.test.js
```

Expected: FAIL — `Cannot find module '../physics'`

- [ ] **Step 3: Implement physics.js**

```js
const CELL_SIZE = 64;
const TANK_RADIUS = 16;

function isWall(x, y, grid) {
  const col = Math.floor(x / CELL_SIZE);
  const row = Math.floor(y / CELL_SIZE);
  if (col < 0 || row < 0 || row >= grid.length || col >= grid[0].length) return true;
  return grid[row][col] === 1;
}

// Check 4 cardinal extremes of the tank's collision circle
function isPositionValid(x, y, radius, grid) {
  return (
    !isWall(x - radius, y, grid) &&
    !isWall(x + radius, y, grid) &&
    !isWall(x, y - radius, grid) &&
    !isWall(x, y + radius, grid)
  );
}

// Axis-separated movement so tanks can slide along walls
function applyMovement(x, y, angle, speed, grid) {
  const dx = Math.cos(angle) * speed;
  const dy = Math.sin(angle) * speed;
  const nx = isPositionValid(x + dx, y, TANK_RADIUS, grid) ? x + dx : x;
  const ny = isPositionValid(nx, y + dy, TANK_RADIUS, grid) ? y + dy : y;
  return { x: nx, y: ny };
}

function applyTurn(angle, delta) {
  return ((angle + delta) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
}

// DDA line-of-sight ray. Returns true if no wall between (x1,y1) and (x2,y2).
// Only wall cells (grid value 1) block LOS — other tanks do not.
function castLosRay(x1, y1, x2, y2, grid) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return true;

  const dirX = dx / dist;
  const dirY = dy / dist;

  let mapX = Math.floor(x1 / CELL_SIZE);
  let mapY = Math.floor(y1 / CELL_SIZE);

  const deltaDistX = Math.abs(CELL_SIZE / dirX);
  const deltaDistY = Math.abs(CELL_SIZE / dirY);

  let sideDistX = dirX < 0
    ? (x1 - mapX * CELL_SIZE) * Math.abs(1 / dirX)
    : ((mapX + 1) * CELL_SIZE - x1) * Math.abs(1 / dirX);
  let sideDistY = dirY < 0
    ? (y1 - mapY * CELL_SIZE) * Math.abs(1 / dirY)
    : ((mapY + 1) * CELL_SIZE - y1) * Math.abs(1 / dirY);

  const stepX = dirX < 0 ? -1 : 1;
  const stepY = dirY < 0 ? -1 : 1;
  let traveled = 0;

  while (traveled < dist) {
    if (sideDistX < sideDistY) {
      traveled = sideDistX;
      sideDistX += deltaDistX;
      mapX += stepX;
    } else {
      traveled = sideDistY;
      sideDistY += deltaDistY;
      mapY += stepY;
    }
    if (traveled >= dist) break;
    if (mapY < 0 || mapY >= grid.length || mapX < 0 || mapX >= grid[0].length) return false;
    if (grid[mapY][mapX] === 1) return false;
  }
  return true;
}

function distanceBetween(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

module.exports = {
  isWall, isPositionValid, applyMovement, applyTurn,
  castLosRay, distanceBetween,
  CELL_SIZE, TANK_RADIUS,
};
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/physics.test.js
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add physics.js tests/physics.test.js
git commit -m "feat: add physics module with movement, collision, and LOS ray casting"
```

---

## Task 4: Game State Module

**Files:**
- Create: `game-state.js`
- Create: `tests/game-state.test.js`

- [ ] **Step 1: Write failing tests**

`tests/game-state.test.js`:
```js
const {
  createGameState, selectSpawnPoint, spawnTank,
  addKill, checkWinCondition, reserveSpawn,
} = require('../game-state');
const { MAPS } = require('../maps');

function freshState() {
  return createGameState(MAPS['B']);
}

describe('createGameState', () => {
  test('initializes with empty tanks, projectiles, scores', () => {
    const gs = freshState();
    expect(gs.tanks.size).toBe(0);
    expect(gs.projectiles.size).toBe(0);
    expect(gs.scores.size).toBe(0);
    expect(gs.nextProjectileId).toBe(0);
  });
});

describe('selectSpawnPoint', () => {
  test('returns a spawn point index when no tanks exist', () => {
    const gs = freshState();
    const idx = selectSpawnPoint(gs, []);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(gs.map.spawns.length);
  });

  test('avoids reserved spawn points', () => {
    const gs = freshState();
    for (let i = 0; i < 8; i++) {
      if (i !== 3) gs.spawnReservations.set(i, Date.now() + 5000);
    }
    const idx = selectSpawnPoint(gs, []);
    expect(idx).toBe(3);
  });

  test('falls back to soonest-expiring if all reserved', () => {
    const gs = freshState();
    const now = Date.now();
    for (let i = 0; i < 8; i++) {
      gs.spawnReservations.set(i, now + (i + 1) * 1000);
    }
    const idx = selectSpawnPoint(gs, []);
    expect(idx).toBe(0);
  });
});

describe('spawnTank', () => {
  test('adds tank to game state at a cell center', () => {
    const gs = freshState();
    spawnTank(gs, 'sock1', 'Alice', false);
    const tank = gs.tanks.get('sock1');
    expect(tank).toBeDefined();
    expect(tank.hp).toBe(100);
    expect(tank.name).toBe('Alice');
    expect(tank.isBot).toBe(false);
    expect(tank.x % 64).toBeCloseTo(32, 0);
    expect(tank.y % 64).toBeCloseTo(32, 0);
  });

  test('initializes score to 0', () => {
    const gs = freshState();
    spawnTank(gs, 'sock1', 'Alice', false);
    expect(gs.scores.get('sock1')).toBe(0);
  });
});

describe('addKill', () => {
  test('increments score for killer', () => {
    const gs = freshState();
    spawnTank(gs, 'sock1', 'Alice', false);
    addKill(gs, 'sock1');
    expect(gs.scores.get('sock1')).toBe(1);
  });
});

describe('checkWinCondition', () => {
  test('returns null when no one has 10 kills', () => {
    const gs = freshState();
    spawnTank(gs, 'sock1', 'Alice', false);
    gs.scores.set('sock1', 9);
    expect(checkWinCondition(gs)).toBeNull();
  });

  test('returns winner name when someone reaches 10 kills', () => {
    const gs = freshState();
    spawnTank(gs, 'sock1', 'Alice', false);
    gs.scores.set('sock1', 10);
    expect(checkWinCondition(gs)).toBe('Alice');
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npm test -- tests/game-state.test.js
```

Expected: FAIL — `Cannot find module '../game-state'`

- [ ] **Step 3: Implement game-state.js**

```js
const CELL_SIZE = 64;
const MAX_HP = 100;
const WIN_KILLS = 10;
const RESPAWN_RESERVE_MS = 2000;

function createGameState(map) {
  return {
    map,
    tanks: new Map(),
    projectiles: new Map(),
    scores: new Map(),
    nextProjectileId: 0,
    spawnReservations: new Map(), // spawnIndex -> expiryTimestamp
  };
}

// Returns the spawn index to use, respecting reservations.
// Picks the spawn farthest from all living enemies.
// If all are reserved, returns the one expiring soonest.
function selectSpawnPoint(gs, livingEnemyPositions) {
  const now = Date.now();
  const available = [];
  const reserved = [];

  gs.map.spawns.forEach(([col, row], idx) => {
    const exp = gs.spawnReservations.get(idx);
    if (!exp || exp <= now) {
      available.push(idx);
    } else {
      reserved.push({ idx, exp });
    }
  });

  if (available.length === 0) {
    reserved.sort((a, b) => a.exp - b.exp);
    return reserved[0].idx;
  }

  if (livingEnemyPositions.length === 0) return available[0];

  let bestIdx = available[0];
  let bestMinDist = -1;

  for (const idx of available) {
    const [col, row] = gs.map.spawns[idx];
    const wx = col * CELL_SIZE + CELL_SIZE / 2;
    const wy = row * CELL_SIZE + CELL_SIZE / 2;

    const minDist = livingEnemyPositions.reduce((min, [ex, ey]) => {
      const d = Math.sqrt((wx - ex) ** 2 + (wy - ey) ** 2);
      return Math.min(min, d);
    }, Infinity);

    if (minDist > bestMinDist) {
      bestMinDist = minDist;
      bestIdx = idx;
    }
  }

  return bestIdx;
}

function reserveSpawn(gs, spawnIdx) {
  gs.spawnReservations.set(spawnIdx, Date.now() + RESPAWN_RESERVE_MS);
}

function spawnTank(gs, id, name, isBot) {
  const enemies = Array.from(gs.tanks.values())
    .filter((t) => t.id !== id && t.hp > 0)
    .map((t) => [t.x, t.y]);

  const spawnIdx = selectSpawnPoint(gs, enemies);
  reserveSpawn(gs, spawnIdx);

  const [col, row] = gs.map.spawns[spawnIdx];
  const x = col * CELL_SIZE + CELL_SIZE / 2;
  const y = row * CELL_SIZE + CELL_SIZE / 2;

  const tank = {
    id,
    name,
    x,
    y,
    angle: 0,
    hp: MAX_HP,
    isBot,
    lastShot: 0,
    inputKeys: { w: false, a: false, s: false, d: false, space: false },
    respawnTimer: null,
    aiState: 'roam',
    currentWaypoint: null,
    noTargetTimer: 0,
  };

  gs.tanks.set(id, tank);
  if (!gs.scores.has(id)) gs.scores.set(id, 0);
}

function addKill(gs, killerId) {
  const current = gs.scores.get(killerId) || 0;
  gs.scores.set(killerId, current + 1);
}

function checkWinCondition(gs) {
  for (const [id, score] of gs.scores) {
    if (score >= WIN_KILLS) {
      const tank = gs.tanks.get(id);
      return tank ? tank.name : null;
    }
  }
  return null;
}

function createProjectile(gs, ownerId, x, y, angle) {
  const id = gs.nextProjectileId++;
  const proj = { id, ownerId, x, y, angle, distanceTraveled: 0 };
  gs.projectiles.set(id, proj);
  return proj;
}

module.exports = {
  createGameState,
  selectSpawnPoint,
  reserveSpawn,
  spawnTank,
  addKill,
  checkWinCondition,
  createProjectile,
};
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/game-state.test.js
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add game-state.js tests/game-state.test.js
git commit -m "feat: add game state module with spawn selection and scoring"
```

---

## Task 5: Bot AI Module

**Files:**
- Create: `bot-ai.js`
- Create: `tests/bot-ai.test.js`

- [ ] **Step 1: Write failing tests**

`tests/bot-ai.test.js`:
```js
const { generateWaypoints, tickBot } = require('../bot-ai');

const GRID_OPEN = [
  [1,1,1,1],
  [1,0,0,1],
  [1,0,0,1],
  [1,1,1,1],
];

describe('generateWaypoints', () => {
  test('generates waypoints only for open cells', () => {
    const wps = generateWaypoints(GRID_OPEN);
    expect(wps.length).toBe(4);
  });

  test('each waypoint has col and row pointing to an open cell', () => {
    const wps = generateWaypoints(GRID_OPEN);
    wps.forEach((wp) => {
      expect(wp.col).toBeDefined();
      expect(wp.row).toBeDefined();
      expect(GRID_OPEN[wp.row][wp.col]).toBe(0);
    });
  });
});

describe('tickBot', () => {
  const waypoints = generateWaypoints(GRID_OPEN);

  function makeTank(overrides = {}) {
    return {
      id: 'bot-1', x: 96, y: 96, angle: 0, hp: 100,
      isBot: true, lastShot: 0,
      inputKeys: { w: false, a: false, s: false, d: false, space: false },
      aiState: 'roam', currentWaypoint: null, noTargetTimer: 0,
      ...overrides,
    };
  }

  test('bot in roam state picks a waypoint if none set', () => {
    const bot = makeTank();
    tickBot(bot, [], waypoints, GRID_OPEN, Date.now());
    expect(bot.currentWaypoint).not.toBeNull();
  });

  test('bot transitions to engage when human is close and has LOS', () => {
    const bot = makeTank({ x: 96, y: 96 });
    const human = { id: 'h1', x: 128, y: 96, hp: 100, isBot: false };
    tickBot(bot, [human], waypoints, GRID_OPEN, Date.now());
    expect(bot.aiState).toBe('engage');
  });

  test('bot stays in roam when no humans are present', () => {
    const bot = makeTank();
    tickBot(bot, [], waypoints, GRID_OPEN, Date.now());
    expect(bot.aiState).toBe('roam');
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npm test -- tests/bot-ai.test.js
```

Expected: FAIL — `Cannot find module '../bot-ai'`

- [ ] **Step 3: Implement bot-ai.js**

```js
const { castLosRay, applyMovement, applyTurn, distanceBetween } = require('./physics');

const CELL_SIZE = 64;
const ENGAGE_RANGE = 6 * CELL_SIZE;    // 384 world units
const NO_TARGET_TIMEOUT = 2000;         // ms before returning to roam
const TURN_SPEED = Math.PI / 30;        // 6 degrees per tick, same as player
const MOVE_SPEED = 4;
const SHOOT_COOLDOWN = 500;

function generateWaypoints(grid) {
  const waypoints = [];
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      if (grid[row][col] === 0) {
        waypoints.push({
          col, row,
          x: col * CELL_SIZE + CELL_SIZE / 2,
          y: row * CELL_SIZE + CELL_SIZE / 2,
        });
      }
    }
  }
  return waypoints;
}

function pickRandomWaypoint(waypoints, excludeX, excludeY) {
  const candidates = waypoints.filter(
    (wp) => Math.abs(wp.x - excludeX) > CELL_SIZE || Math.abs(wp.y - excludeY) > CELL_SIZE
  );
  const pool = candidates.length > 0 ? candidates : waypoints;
  return pool[Math.floor(Math.random() * pool.length)];
}

function shortestAngleDiff(current, target) {
  return ((target - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

// Mutates bot tank object. Called once per server tick (20/sec).
function tickBot(bot, humanTanks, waypoints, grid, now) {
  bot.inputKeys = { w: false, a: false, s: false, d: false, space: false };

  // Find nearest visible human within engage range
  let target = null;
  let targetDist = Infinity;
  for (const h of humanTanks) {
    if (h.hp <= 0) continue;
    const d = distanceBetween(bot.x, bot.y, h.x, h.y);
    if (d <= ENGAGE_RANGE && d < targetDist && castLosRay(bot.x, bot.y, h.x, h.y, grid)) {
      target = h;
      targetDist = d;
    }
  }

  if (target) {
    bot.aiState = 'engage';
    bot.noTargetTimer = 0;

    // Turn toward target (capped at TURN_SPEED per tick)
    const desiredAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
    const diff = shortestAngleDiff(bot.angle, desiredAngle);
    if (Math.abs(diff) > TURN_SPEED) {
      bot.angle = applyTurn(bot.angle, diff > 0 ? TURN_SPEED : -TURN_SPEED);
    }

    // Shoot if roughly aligned and cooldown expired
    if (Math.abs(diff) < Math.PI / 6 && now - bot.lastShot >= SHOOT_COOLDOWN) {
      bot.inputKeys.space = true;
    }
  } else {
    if (bot.aiState === 'engage') {
      bot.noTargetTimer += 50; // one tick at 20/sec
      if (bot.noTargetTimer >= NO_TARGET_TIMEOUT) {
        bot.aiState = 'roam';
        bot.currentWaypoint = null;
        bot.noTargetTimer = 0;
      }
    }

    // Roam toward waypoint
    if (!bot.currentWaypoint) {
      bot.currentWaypoint = pickRandomWaypoint(waypoints, bot.x, bot.y);
    }

    const { x: wx, y: wy } = bot.currentWaypoint;
    const dist = distanceBetween(bot.x, bot.y, wx, wy);

    if (dist < CELL_SIZE / 2) {
      bot.currentWaypoint = pickRandomWaypoint(waypoints, bot.x, bot.y);
    } else {
      const desiredAngle = Math.atan2(wy - bot.y, wx - bot.x);
      const diff = shortestAngleDiff(bot.angle, desiredAngle);
      if (Math.abs(diff) > TURN_SPEED) {
        bot.angle = applyTurn(bot.angle, diff > 0 ? TURN_SPEED : -TURN_SPEED);
      }
      bot.inputKeys.w = true;
    }
  }

  // Apply movement
  if (bot.inputKeys.w) {
    const moved = applyMovement(bot.x, bot.y, bot.angle, MOVE_SPEED, grid);
    bot.x = moved.x;
    bot.y = moved.y;
  }
}

module.exports = { generateWaypoints, tickBot };
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/bot-ai.test.js
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bot-ai.js tests/bot-ai.test.js
git commit -m "feat: add bot AI module with waypoint roaming and engage state machine"
```

---

## Task 6: Server Game Loop + Socket.io

**Files:**
- Modify: `server.js` (full implementation)
- Modify: `tests/server.test.js` (integration tests)

- [ ] **Step 1: Write failing integration tests**

Replace `tests/server.test.js`:
```js
const http = require('http');
const { io: ioClient } = require('socket.io-client');

// server.js exports {app, server, io}; use a test port to avoid conflicts
process.env.PORT = '3099';
const { server } = require('../server');

beforeAll((done) => server.listen(3099, done));
afterAll((done) => server.close(done));

const URL = 'http://localhost:3099';

function connect() {
  return new Promise((resolve) => {
    const s = ioClient(URL);
    s.on('connect', () => resolve(s));
  });
}

test('server accepts connections', (done) => {
  const s = ioClient(URL);
  s.on('connect', () => { expect(s.connected).toBe(true); s.disconnect(); done(); });
});

test('join with valid name receives lobby-state', (done) => {
  connect().then((s) => {
    s.on('lobby-state', (data) => {
      expect(data.players.some((p) => p.name === 'Alice_' + process.pid)).toBe(true);
      expect(data.hostId).toBeDefined();
      s.disconnect();
      done();
    });
    s.emit('join', { name: 'Alice_' + process.pid });
  });
});

test('join with duplicate name receives name-error', (done) => {
  const name = 'Dupe_' + Date.now();
  connect().then((s1) => {
    s1.on('lobby-state', () => {
      connect().then((s2) => {
        s2.on('name-error', (data) => {
          expect(data.message).toMatch(/taken/i);
          s1.disconnect(); s2.disconnect();
          done();
        });
        s2.emit('join', { name });
      });
    });
    s1.emit('join', { name });
  });
});

test('first connected player is host', (done) => {
  const name = 'Host_' + Date.now();
  connect().then((s) => {
    s.on('lobby-state', (data) => {
      expect(data.hostId).toBe(s.id);
      s.disconnect();
      done();
    });
    s.emit('join', { name });
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npm test -- tests/server.test.js
```

Expected: Connection test passes; join tests fail — no handler yet.

- [ ] **Step 3: Implement full server.js**

```js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { MAPS } = require('./maps');
const { createGameState, spawnTank, addKill, checkWinCondition, createProjectile } = require('./game-state');
const { applyMovement, applyTurn } = require('./physics');
const { generateWaypoints, tickBot } = require('./bot-ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ── Constants ──────────────────────────────────────────────────────────────
const MOVE_SPEED = 4;
const TURN_SPEED = Math.PI / 30;
const PROJECTILE_SPEED = 20;
const PROJECTILE_MAX_RANGE = 512;
const SHOOT_COOLDOWN = 500;
const RESPAWN_DELAY = 2000;
const TICK_MS = 50;
const MIN_TOTAL_TANKS = 4;

// ── Lobby & game state ─────────────────────────────────────────────────────
let lobby = { players: [], hostId: null, waitingPlayers: [] };
let gameState = null;
let gamePhase = 'lobby';
let waypoints = [];
let gameLoopInterval = null;
let nextBotNum = 1;

function broadcastLobbyState() {
  io.to('lobby').emit('lobby-state', {
    players: lobby.players.map(({ id, name }) => ({ id, name })),
    hostId: lobby.hostId,
  });
}

// ── Socket.io ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  if (gamePhase === 'playing') {
    socket.emit('waiting', { message: 'Game in progress — please wait' });

    socket.on('join', ({ name }) => {
      const n = (name || '').trim().slice(0, 16);
      if (!n) return socket.emit('name-error', { message: 'Name required' });
      const taken = [...lobby.players, ...lobby.waitingPlayers].some((p) => p.name === n);
      if (taken) return socket.emit('name-error', { message: 'Name already taken' });
      const waiter = lobby.waitingPlayers.find((p) => p.id === socket.id);
      if (waiter) waiter.name = n;
    });

    const waiter = { id: socket.id, name: null, socket };
    lobby.waitingPlayers.push(waiter);

    socket.on('disconnect', () => {
      lobby.waitingPlayers = lobby.waitingPlayers.filter((p) => p.id !== socket.id);
    });
    return;
  }

  socket.join('lobby');

  socket.on('join', ({ name }) => {
    const n = (name || '').trim().slice(0, 16);
    if (!n) return socket.emit('name-error', { message: 'Name required' });
    if (lobby.players.some((p) => p.name === n)) {
      return socket.emit('name-error', { message: 'Name already taken' });
    }
    lobby.players.push({ id: socket.id, name: n });
    if (!lobby.hostId) lobby.hostId = socket.id;
    broadcastLobbyState();
  });

  socket.on('start-game', ({ map }) => {
    if (socket.id !== lobby.hostId || !MAPS[map]) return;
    startGame(map);
  });

  socket.on('input', (keys) => {
    if (!gameState) return;
    const tank = gameState.tanks.get(socket.id);
    if (tank && tank.hp > 0) tank.inputKeys = keys;
  });

  socket.on('disconnect', () => {
    lobby.players = lobby.players.filter((p) => p.id !== socket.id);
    if (gameState) gameState.tanks.delete(socket.id);
    if (socket.id === lobby.hostId) {
      lobby.hostId = lobby.players.length > 0 ? lobby.players[0].id : null;
    }
    broadcastLobbyState();
  });
});

// ── Game loop ──────────────────────────────────────────────────────────────
function startGame(mapKey) {
  gamePhase = 'playing';
  nextBotNum = 1;
  const map = MAPS[mapKey];
  gameState = createGameState(map);
  waypoints = generateWaypoints(map.grid);

  for (const player of lobby.players) {
    spawnTank(gameState, player.id, player.name, false);
  }

  const botsNeeded = Math.max(0, MIN_TOTAL_TANKS - lobby.players.length);
  for (let i = 0; i < botsNeeded; i++) {
    const botId = 'bot-' + nextBotNum;
    spawnTank(gameState, botId, 'Bot' + nextBotNum, true);
    nextBotNum++;
  }

  io.to('lobby').emit('game-start', { map: mapKey });
  io.to('lobby').emit('map-data', { grid: map.grid });

  gameLoopInterval = setInterval(gameTick, TICK_MS);
}

function gameTick() {
  const now = Date.now();
  const map = gameState.map;

  // Tick bots
  const humanTanks = Array.from(gameState.tanks.values()).filter((t) => !t.isBot && t.hp > 0);
  for (const tank of gameState.tanks.values()) {
    if (tank.isBot && tank.hp > 0) tickBot(tank, humanTanks, waypoints, map.grid, now);
  }

  // Apply input and physics for all tanks
  for (const tank of gameState.tanks.values()) {
    if (tank.hp <= 0) continue;
    const { w, a, s, d, space } = tank.inputKeys;

    if (a) tank.angle = applyTurn(tank.angle, -TURN_SPEED);
    if (d) tank.angle = applyTurn(tank.angle, TURN_SPEED);
    if (w) { const m = applyMovement(tank.x, tank.y, tank.angle, MOVE_SPEED, map.grid); tank.x = m.x; tank.y = m.y; }
    if (s) { const m = applyMovement(tank.x, tank.y, tank.angle, -MOVE_SPEED, map.grid); tank.x = m.x; tank.y = m.y; }

    if (space && now - tank.lastShot >= SHOOT_COOLDOWN) {
      tank.lastShot = now;
      createProjectile(gameState, tank.id, tank.x, tank.y, tank.angle);
    }
  }

  // Move projectiles and check collisions
  const toRemove = [];
  for (const proj of gameState.projectiles.values()) {
    proj.x += Math.cos(proj.angle) * PROJECTILE_SPEED;
    proj.y += Math.sin(proj.angle) * PROJECTILE_SPEED;
    proj.distanceTraveled += PROJECTILE_SPEED;

    const col = Math.floor(proj.x / 64);
    const row = Math.floor(proj.y / 64);
    const outOfBounds = row < 0 || row >= 16 || col < 0 || col >= 16;
    if (outOfBounds || map.grid[row][col] === 1 || proj.distanceTraveled >= PROJECTILE_MAX_RANGE) {
      toRemove.push(proj.id);
      continue;
    }

    for (const tank of gameState.tanks.values()) {
      if (tank.id === proj.ownerId || tank.hp <= 0) continue;
      const dx = tank.x - proj.x;
      const dy = tank.y - proj.y;
      if (Math.sqrt(dx * dx + dy * dy) < 20) {
        tank.hp -= 25;
        toRemove.push(proj.id);
        if (tank.hp <= 0) {
          tank.hp = 0;
          addKill(gameState, proj.ownerId);
          const deadId = tank.id;
          const deadName = tank.name;
          const isBot = tank.isBot;
          setTimeout(() => {
            if (gameState && gameState.tanks.has(deadId)) {
              spawnTank(gameState, deadId, deadName, isBot);
            }
          }, RESPAWN_DELAY);
        }
        break;
      }
    }
  }
  toRemove.forEach((id) => gameState.projectiles.delete(id));

  const winner = checkWinCondition(gameState);
  if (winner) { endGame(winner); return; }

  // Broadcast to active players only
  const tanks = Array.from(gameState.tanks.values())
    .map(({ id, name, x, y, angle, hp, isBot }) => ({ id, name, x, y, angle, hp, isBot }));
  const projectiles = Array.from(gameState.projectiles.values())
    .map(({ id, ownerId, x, y, angle }) => ({ id, ownerId, x, y, angle }));
  const scores = Object.fromEntries(gameState.scores);

  io.to('lobby').emit('game-state', { tanks, projectiles, scores });
}

function endGame(winner) {
  clearInterval(gameLoopInterval);
  gameLoopInterval = null;
  gamePhase = 'gameover';
  io.to('lobby').emit('game-over', { winner });

  setTimeout(() => {
    for (const waiter of lobby.waitingPlayers) {
      if (waiter.name) {
        lobby.players.push({ id: waiter.id, name: waiter.name });
        waiter.socket.join('lobby');
      }
    }
    lobby.waitingPlayers = [];
    gameState = null;
    gamePhase = 'lobby';
    broadcastLobbyState();
  }, 5000);
}

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.listen(PORT, () => {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    let localIp = 'localhost';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) { localIp = net.address; break; }
      }
    }
    console.log(`Spectre Tank Game`);
    console.log(`Network: http://${localIp}:${PORT}`);
    console.log(`Local:   http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io };
```

- [ ] **Step 4: Run integration tests**

```bash
npm test -- tests/server.test.js
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Manual smoke test**

```bash
node server.js
```

Open `http://localhost:3000` — should see placeholder HTML, no terminal errors.

- [ ] **Step 6: Commit**

```bash
git add server.js tests/server.test.js
git commit -m "feat: add full server game loop, lobby management, and Socket.io event handling"
```

---

## Task 7: Client Network Layer

**Files:**
- Create: `public/network.js`

- [ ] **Step 1: Create public/network.js**

```js
// Thin Socket.io client wrapper. Exposes a global `Network` object.
// Scripts must load socket.io client before this file.

const Network = (() => {
  let socket = null;
  const handlers = {};

  function on(event, fn) { handlers[event] = fn; }

  function connect() {
    socket = io(); // socket.io.js loaded via CDN script tag in index.html
    ['lobby-state', 'game-state', 'game-over', 'game-start',
     'map-data', 'waiting', 'name-error'].forEach((evt) => {
      socket.on(evt, (data) => { if (handlers[evt]) handlers[evt](data); });
    });
  }

  function join(name) { if (socket) socket.emit('join', { name }); }
  function startGame(map) { if (socket) socket.emit('start-game', { map }); }
  function sendInput(keys) { if (socket) socket.emit('input', keys); }
  function getId() { return socket ? socket.id : null; }

  return { connect, join, startGame, sendInput, on, getId };
})();
```

- [ ] **Step 2: Commit**

```bash
git add public/network.js
git commit -m "feat: add client network layer (Socket.io wrapper)"
```

---

## Task 8: Raycasting Renderer

**Files:**
- Create: `public/renderer.js`

- [ ] **Step 1: Create public/renderer.js**

```js
// DDA raycasting renderer. Exposes a global `Renderer` object.
// Renders wireframe walls, tank/projectile sprites, and minimap.

const Renderer = (() => {
  const CELL_SIZE = 64;
  const FOV = 66 * Math.PI / 180;
  const HALF_FOV = FOV / 2;
  const CANVAS_W = 320;
  const CANVAS_H = 240;
  const MAX_DIST = 8 * CELL_SIZE;
  const GREEN = '#00ff00';

  let ctx, mapCtx;
  let zBuffer = new Float32Array(CANVAS_W);

  function init(gameCanvas, minimapCanvas) {
    ctx = gameCanvas.getContext('2d');
    mapCtx = minimapCanvas.getContext('2d');
  }

  // DDA ray cast. Returns { dist, side, mapX, mapY }.
  function castRay(px, py, angle, grid) {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    let mapX = Math.floor(px / CELL_SIZE);
    let mapY = Math.floor(py / CELL_SIZE);

    const deltaDistX = Math.abs(CELL_SIZE / dirX);
    const deltaDistY = Math.abs(CELL_SIZE / dirY);

    let sideDistX = (dirX < 0
      ? (px - mapX * CELL_SIZE)
      : ((mapX + 1) * CELL_SIZE - px)) * Math.abs(1 / dirX);
    let sideDistY = (dirY < 0
      ? (py - mapY * CELL_SIZE)
      : ((mapY + 1) * CELL_SIZE - py)) * Math.abs(1 / dirY);

    const stepX = dirX < 0 ? -1 : 1;
    const stepY = dirY < 0 ? -1 : 1;
    let side = 0;
    let iters = 0;

    while (iters++ < 64) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX; mapX += stepX; side = 0;
      } else {
        sideDistY += deltaDistY; mapY += stepY; side = 1;
      }
      if (mapY < 0 || mapY >= grid.length || mapX < 0 || mapX >= grid[0].length) break;
      if (grid[mapY][mapX] === 1) break;
    }

    // Perpendicular distance (corrects fisheye)
    const dist = side === 0
      ? (sideDistX - deltaDistX)
      : (sideDistY - deltaDistY);

    return { dist: Math.max(1, dist), side, mapX, mapY };
  }

  function render(player, tanks, projectiles, grid) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const prevHits = new Array(CANVAS_W);

    for (let col = 0; col < CANVAS_W; col++) {
      const rayAngle = player.angle - HALF_FOV + (col / CANVAS_W) * FOV;
      const hit = castRay(player.x, player.y, rayAngle, grid);
      zBuffer[col] = hit.dist;

      const wallH = Math.min(CANVAS_H, Math.floor(CELL_SIZE * CANVAS_H / hit.dist));
      const top = Math.floor((CANVAS_H - wallH) / 2);
      const bot = top + wallH;
      const alpha = Math.max(0.18, 1 - hit.dist / MAX_DIST);

      ctx.strokeStyle = `rgba(0,255,0,${alpha})`;
      ctx.lineWidth = 1;

      // Top edge
      ctx.beginPath(); ctx.moveTo(col, top); ctx.lineTo(col + 1, top); ctx.stroke();
      // Bottom edge
      ctx.beginPath(); ctx.moveTo(col, bot); ctx.lineTo(col + 1, bot); ctx.stroke();

      // Vertical edge where wall face changes
      if (col > 0 && prevHits[col - 1]) {
        const p = prevHits[col - 1];
        if (p.mapX !== hit.mapX || p.mapY !== hit.mapY || p.side !== hit.side) {
          ctx.beginPath(); ctx.moveTo(col, p.top); ctx.lineTo(col, top); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(col, p.bot); ctx.lineTo(col, bot); ctx.stroke();
        }
      }

      prevHits[col] = { mapX: hit.mapX, mapY: hit.mapY, side: hit.side, top, bot };
    }

    // Crosshair
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 1;
    const cx = CANVAS_W / 2, cy = CANVAS_H / 2;
    ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();

    // Sort sprites back-to-front
    const sprites = [];
    if (tanks) {
      for (const tank of tanks) {
        if (tank.id !== player.id && tank.hp > 0) sprites.push({ type: 'tank', obj: tank });
      }
    }
    if (projectiles) {
      for (const proj of projectiles) sprites.push({ type: 'proj', obj: proj });
    }
    sprites.sort((a, b) => {
      const da = (a.obj.x - player.x) ** 2 + (a.obj.y - player.y) ** 2;
      const db = (b.obj.x - player.x) ** 2 + (b.obj.y - player.y) ** 2;
      return db - da;
    });
    sprites.forEach(({ type, obj }) => drawSprite(player, obj, type));
  }

  function drawSprite(player, obj, type) {
    const dx = obj.x - player.x;
    const dy = obj.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 8) return;

    // Must be in front of player
    if (Math.cos(player.angle) * dx + Math.sin(player.angle) * dy <= 0) return;

    const spriteAngle = Math.atan2(dy, dx) - player.angle;
    const normAngle = ((spriteAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(normAngle) > HALF_FOV + 0.3) return;

    const screenX = Math.floor(CANVAS_W / 2 + Math.tan(normAngle) * (CANVAS_W / FOV));
    const alpha = Math.max(0.18, 1 - dist / MAX_DIST);

    if (type === 'tank') {
      const h = Math.min(CANVAS_H, Math.floor(CELL_SIZE * CANVAS_H / dist));
      const w = Math.floor(h * 0.75);
      const top = Math.floor((CANVAS_H - h) / 2);
      const left = screenX - Math.floor(w / 2);

      let visible = false;
      const c0 = Math.max(0, left);
      const c1 = Math.min(CANVAS_W - 1, left + w);
      for (let c = c0; c <= c1; c++) {
        if (dist < zBuffer[c]) { visible = true; break; }
      }
      if (!visible) return;

      ctx.strokeStyle = `rgba(0,255,0,${alpha * 0.9})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(left, top, w, h);
      ctx.beginPath();
      ctx.moveTo(screenX, top);
      ctx.lineTo(screenX, top - Math.floor(h * 0.25));
      ctx.stroke();

    } else {
      const size = Math.max(3, Math.floor(6 * CANVAS_H / dist));
      const cy = Math.floor(CANVAS_H / 2);

      let visible = false;
      const c0 = Math.max(0, screenX - 2);
      const c1 = Math.min(CANVAS_W - 1, screenX + 2);
      for (let c = c0; c <= c1; c++) {
        if (dist < zBuffer[c]) { visible = true; break; }
      }
      if (!visible) return;

      ctx.strokeStyle = `rgba(0,255,0,${alpha * 0.7})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(screenX, cy - size);
      ctx.lineTo(screenX + size, cy);
      ctx.lineTo(screenX, cy + size);
      ctx.lineTo(screenX - size, cy);
      ctx.closePath();
      ctx.stroke();
    }
  }

  function renderMinimap(player, tanks, grid) {
    const W = mapCtx.canvas.width;
    const H = mapCtx.canvas.height;
    const rows = grid.length;
    const cols = grid[0].length;
    const cw = W / cols;
    const ch = H / rows;

    mapCtx.fillStyle = '#000';
    mapCtx.fillRect(0, 0, W, H);

    // Walls
    mapCtx.fillStyle = 'rgba(0,255,0,0.35)';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 1) mapCtx.fillRect(c * cw, r * ch, cw, ch);
      }
    }

    // Other tanks
    if (tanks) {
      mapCtx.fillStyle = 'rgba(0,255,0,0.7)';
      for (const tank of tanks) {
        if (tank.id === player.id || tank.hp <= 0) continue;
        const tx = (tank.x / (cols * CELL_SIZE)) * W;
        const ty = (tank.y / (rows * CELL_SIZE)) * H;
        mapCtx.beginPath();
        mapCtx.arc(tx, ty, 2, 0, Math.PI * 2);
        mapCtx.fill();
      }
    }

    // Player dot + direction line
    const px = (player.x / (cols * CELL_SIZE)) * W;
    const py = (player.y / (rows * CELL_SIZE)) * H;
    mapCtx.fillStyle = GREEN;
    mapCtx.beginPath(); mapCtx.arc(px, py, 3, 0, Math.PI * 2); mapCtx.fill();
    mapCtx.strokeStyle = GREEN;
    mapCtx.lineWidth = 1.5;
    mapCtx.beginPath();
    mapCtx.moveTo(px, py);
    mapCtx.lineTo(px + Math.cos(player.angle) * 8, py + Math.sin(player.angle) * 8);
    mapCtx.stroke();
  }

  return { init, render, renderMinimap };
})();
```

- [ ] **Step 2: Commit**

```bash
git add public/renderer.js
git commit -m "feat: add raycasting renderer with wireframe walls, sprite projection, and minimap"
```

---

## Task 9: Client Game Loop + Input

**Files:**
- Create: `public/game.js`

- [ ] **Step 1: Create public/game.js**

```js
// Client game loop. Exposes a global `Game` object.
// Depends on: Network, Renderer (loaded before this script).

const Game = (() => {
  const keys = { w: false, a: false, s: false, d: false, space: false };
  let hudCanvas, hudCtx;
  let localPlayerId = null;
  let lastGameState = null;
  let animFrame = null;
  let running = false;

  const keyMap = {
    'w': 'w', 'arrowup': 'w',
    's': 's', 'arrowdown': 's',
    'a': 'a', 'arrowleft': 'a',
    'd': 'd', 'arrowright': 'd',
    ' ': 'space',
  };

  function init(gameCanvas, minimapCanvas, hCanvas) {
    Renderer.init(gameCanvas, minimapCanvas);
    hudCanvas = hCanvas;
    hudCtx = hCanvas.getContext('2d');
    setupInput();
  }

  function setupInput() {
    document.addEventListener('keydown', (e) => {
      const k = keyMap[e.key.toLowerCase()];
      if (k) { e.preventDefault(); keys[k] = true; }
    });
    document.addEventListener('keyup', (e) => {
      const k = keyMap[e.key.toLowerCase()];
      if (k) keys[k] = false;
    });
  }

  function start(playerId) {
    localPlayerId = playerId;
    running = true;
    loop();
  }

  function stop() {
    running = false;
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  }

  function onGameState(state) {
    lastGameState = state;
  }

  function loop() {
    if (!running) return;
    animFrame = requestAnimationFrame(loop);

    Network.sendInput({ ...keys });

    if (!lastGameState || !lastGameState.grid) return;

    const player = lastGameState.tanks.find((t) => t.id === localPlayerId);
    if (!player) return;

    Renderer.render(player, lastGameState.tanks, lastGameState.projectiles, lastGameState.grid);
    Renderer.renderMinimap(player, lastGameState.tanks, lastGameState.grid);
    renderHud(player, lastGameState.scores);
  }

  function renderHud(player, scores) {
    const W = hudCanvas.width;
    const H = hudCanvas.height;

    hudCtx.fillStyle = '#000';
    hudCtx.fillRect(0, 0, W, H);

    hudCtx.fillStyle = '#00ff00';
    hudCtx.font = '12px monospace';

    // Health label
    hudCtx.textAlign = 'left';
    hudCtx.fillText('HP', 6, H / 2 + 4);

    // Health bar
    const hpFrac = Math.max(0, player.hp / 100);
    const barW = 80;
    const barX = 26;
    const barY = Math.floor(H / 2) - 6;
    hudCtx.strokeStyle = 'rgba(0,255,0,0.4)';
    hudCtx.strokeRect(barX, barY, barW, 12);
    hudCtx.fillStyle = '#00ff00';
    hudCtx.fillRect(barX + 1, barY + 1, Math.floor((barW - 2) * hpFrac), 10);

    // Score
    const myScore = (scores && scores[localPlayerId]) || 0;
    hudCtx.fillStyle = '#00ff00';
    hudCtx.textAlign = 'center';
    hudCtx.fillText('SCORE: ' + myScore, W / 2, H / 2 + 4);

    // Ammo
    hudCtx.textAlign = 'right';
    hudCtx.fillText('AMMO: inf', W - 6, H / 2 + 4);
    hudCtx.textAlign = 'left';
  }

  return { init, start, stop, onGameState };
})();
```

- [ ] **Step 2: Commit**

```bash
git add public/game.js
git commit -m "feat: add client game loop with input handling and HUD rendering"
```

---

## Task 10: Lobby UI + Full HTML

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Replace public/index.html with full implementation**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Spectre Tank Game</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; color: #0f0; font-family: monospace;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; }
    #lobby { text-align: center; max-width: 400px; width: 100%; padding: 20px; }
    #lobby h1 { font-size: 2rem; letter-spacing: 4px; margin-bottom: 4px; }
    .sub { opacity: 0.5; font-size: 0.8rem; margin-bottom: 24px; }
    input[type=text] { background: #000; border: 1px solid #0f0; color: #0f0;
      font-family: monospace; font-size: 1rem; padding: 8px 12px;
      width: 100%; margin-bottom: 10px; outline: none; }
    input[type=text]:focus { box-shadow: 0 0 8px rgba(0,255,0,0.3); }
    button { background: #000; border: 1px solid #0f0; color: #0f0;
      font-family: monospace; font-size: 1rem; padding: 8px 24px;
      cursor: pointer; margin: 4px; }
    button:hover { background: rgba(0,255,0,0.1); }
    #error { color: #f44; font-size: 0.85rem; min-height: 16px; margin-bottom: 6px; }
    #player-list { margin: 16px 0; text-align: left; }
    #player-list h3 { opacity: 0.6; font-size: 0.75rem; margin-bottom: 6px; }
    #player-list ul { list-style: none; }
    #player-list li { padding: 3px 0; }
    #player-list li.is-host::after { content: ' [HOST]'; opacity: 0.4; font-size: 0.75rem; }
    #map-select { margin: 12px 0; }
    #map-select label { opacity: 0.6; font-size: 0.75rem; display: block; margin-bottom: 6px; }
    select { background: #000; border: 1px solid #0f0; color: #0f0;
             font-family: monospace; font-size: 0.9rem; padding: 4px 8px; }
    #waiting-msg { opacity: 0.6; font-size: 0.85rem; margin-top: 12px; }
    #game { display: none; flex-direction: column; align-items: center; }
    #game-area { display: flex; border: 1px solid #0f0; }
    #game-canvas { image-rendering: pixelated; width: 640px; height: 480px; display: block; }
    #minimap { width: 128px; height: 128px; align-self: flex-start; margin-top: 176px;
               border-left: 1px solid rgba(0,255,0,0.3); }
    #hud { width: 769px; height: 28px;
           border-top: 1px solid rgba(0,255,0,0.3); background: #000; }
    #overlay { display: none; position: fixed; inset: 0;
               background: rgba(0,0,0,0.88);
               align-items: center; justify-content: center;
               flex-direction: column; text-align: center; z-index: 10; }
    #overlay h2 { font-size: 2rem; margin-bottom: 12px; }
    #overlay p { opacity: 0.6; }
  </style>
</head>
<body>

<div id="lobby">
  <h1>SPECTRE</h1>
  <p class="sub">Tank Combat — Local Network</p>

  <div id="name-section">
    <input id="name-input" type="text" maxlength="16" placeholder="Enter your name" autofocus>
    <div id="error"></div>
    <button id="join-btn">JOIN GAME</button>
  </div>

  <div id="joined-section" style="display:none">
    <div id="player-list">
      <h3>PLAYERS</h3>
      <ul id="players-ul"></ul>
    </div>
    <div id="map-select" style="display:none">
      <label>SELECT MAP</label>
      <select id="map-sel">
        <option value="A">A — Symmetric Maze</option>
        <option value="B">B — Open Arena</option>
        <option value="C">C — Rooms + Corridors</option>
      </select>
    </div>
    <button id="start-btn" style="display:none">START GAME</button>
    <div id="waiting-msg" style="display:none">Waiting for host to start...</div>
  </div>
</div>

<div id="game">
  <div id="game-area">
    <canvas id="game-canvas" width="320" height="240"></canvas>
    <canvas id="minimap" width="128" height="128"></canvas>
  </div>
  <canvas id="hud" width="769" height="28"></canvas>
</div>

<div id="overlay">
  <h2 id="overlay-title">GAME OVER</h2>
  <p id="overlay-sub">Returning to lobby...</p>
</div>

<script src="/socket.io/socket.io.js"></script>
<script src="network.js"></script>
<script src="renderer.js"></script>
<script src="game.js"></script>
<script>
  let myId = null;
  let myName = null;
  let currentGrid = null;

  // Init subsystems
  Game.init(
    document.getElementById('game-canvas'),
    document.getElementById('minimap'),
    document.getElementById('hud')
  );
  Network.connect();

  // Lobby interactions
  document.getElementById('join-btn').addEventListener('click', () => {
    const name = document.getElementById('name-input').value.trim();
    if (!name) { showError('Enter a name'); return; }
    Network.join(name);
  });

  document.getElementById('name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('join-btn').click();
  });

  document.getElementById('start-btn').addEventListener('click', () => {
    Network.startGame(document.getElementById('map-sel').value);
  });

  function showError(msg) {
    document.getElementById('error').textContent = msg;
  }

  // Network event handlers
  Network.on('name-error', ({ message }) => showError(message));

  Network.on('lobby-state', ({ players, hostId }) => {
    myId = Network.getId();
    // Update myName in case it changed (e.g. after reconnect)
    const me = players.find((p) => p.id === myId);
    if (me) myName = me.name;
    const isHost = myId === hostId;

    document.getElementById('name-section').style.display = 'none';
    document.getElementById('joined-section').style.display = 'block';
    document.getElementById('start-btn').style.display = isHost ? 'inline-block' : 'none';
    document.getElementById('map-select').style.display = isHost ? 'block' : 'none';
    document.getElementById('waiting-msg').style.display = isHost ? 'none' : 'block';

    const ul = document.getElementById('players-ul');
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    players.forEach(({ id, name }) => {
      const li = document.createElement('li');
      li.textContent = name;
      if (id === hostId) li.classList.add('is-host');
      ul.appendChild(li);
    });
  });

  Network.on('waiting', ({ message }) => {
    const el = document.getElementById('waiting-msg');
    el.textContent = message;
    el.style.display = 'block';
  });

  Network.on('map-data', ({ grid }) => { currentGrid = grid; });

  Network.on('game-start', () => {
    myId = Network.getId();
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game').style.display = 'flex';
    Game.start(myId);
  });

  Network.on('game-state', (state) => {
    state.grid = currentGrid;
    Game.onGameState(state);
  });

  Network.on('game-over', ({ winner }) => {
    Game.stop();
    document.getElementById('overlay-title').textContent =
      (winner === myName) ? 'YOU WIN!' : winner + ' WINS!';
    document.getElementById('overlay').style.display = 'flex';

    setTimeout(() => {
      currentGrid = null;
      document.getElementById('overlay').style.display = 'none';
      document.getElementById('game').style.display = 'none';
      document.getElementById('lobby').style.display = 'block';
      document.getElementById('name-section').style.display = 'none';
      document.getElementById('joined-section').style.display = 'block';
    }, 5000);
  });
</script>
</body>
</html>
```

- [ ] **Step 2: Manual end-to-end test**

```bash
node server.js
```

1. Open `http://localhost:3000` — should see the SPECTRE lobby screen
2. Enter name "Alice", click JOIN GAME — should see player list with Alice [HOST]
3. Open a second tab, enter "Bob", JOIN — both tabs show Alice and Bob
4. Tab 1: Select map, click START GAME
5. Both tabs switch to 3D game view — green wireframe walls should be visible
6. WASD moves, Space shoots — verify tank moves and projectiles appear
7. Minimap shows player position and direction
8. HUD shows HP bar, score, AMMO: inf
9. Shoot Bob's tank 4 times — verify respawn after 2 seconds
10. Score a kill — verify score increments in HUD
11. Reach 10 kills — winner screen appears, returns to lobby after 5 seconds

- [ ] **Step 3: Test on second device (same WiFi)**

On the second device, open `http://<ip-from-terminal>:3000` — should reach the lobby. Join and start a multiplayer match.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add lobby UI, game canvas, and HUD layout"
```

---

## Task 11: Final Verification

**Files:** none

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected output:
```
PASS tests/maps.test.js
PASS tests/physics.test.js
PASS tests/game-state.test.js
PASS tests/bot-ai.test.js
PASS tests/server.test.js

Test Suites: 5 passed, 5 total
Tests:       XX passed, XX total
```

- [ ] **Step 2: Verify single-player**

Start the server, join with one player, start the game — 3 bots should appear and engage the player.

- [ ] **Step 3: Verify all three maps**

Repeat the playtest for maps A, B, and C.

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: complete Spectre tank game — raycasting, bot AI, local multiplayer"
```

---

## How to Run

```bash
cd /Users/monty/Desktop/Claude/projects/spectre-tank-game
npm install
node server.js
# Terminal prints the local IP, e.g.: http://192.168.1.42:3000
# Open that URL on any browser on the same WiFi to join
```
