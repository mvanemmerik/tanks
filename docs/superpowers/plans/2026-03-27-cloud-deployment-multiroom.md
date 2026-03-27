# Cloud Deployment + Multi-Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the single-lobby tank game into a multi-room system and deploy it to AWS EC2 with Cloudflare at tanks.vanemmerik.ai.

**Architecture:** All per-game state is extracted from server.js module-level globals into a `Room` object; a `rooms` Map and `socketToRoom` Map manage concurrent rooms. Clients connect to a landing screen, then create or join a room by code or from a public browser. Infrastructure is EC2 t3.micro (us-east-1) → nginx (SSL termination) → Node.js :3000, fronted by Cloudflare free with SSL mode Full and a Cloudflare Origin Certificate on the EC2 side.

**Tech Stack:** Node.js 20, Express, Socket.io 4, Jest, PM2, nginx, Cloudflare Origin Certificate, AWS EC2 Ubuntu 22.04 us-east-1

**Spec:** `docs/superpowers/specs/2026-03-27-cloud-deployment-multiroom-design.md`

---

## File Map

| File | Change | Responsibility |
|------|--------|----------------|
| `server.js` | Rewrite socket layer | Room lifecycle, scoped socket events, game loops per room |
| `tests/server.test.js` | Rewrite | All server socket event tests against new multi-room API |
| `public/network.js` | Modify | Add `createRoom`, `joinRoom`; add `room-created`/`room-error`/`game-list` events; remove `waiting` |
| `public/index.html` | Modify | Add landing/browser screens; update lobby with room code; replace inline script |

---

## Phase 1: Server Refactor

### Task 1: Room infrastructure + new socket API

Add the Room object, `rooms` Map, helpers, and replace all socket handlers. The old single-game globals and `join` event are removed entirely.

**Files:**
- Modify: `server.js`
- Rewrite: `tests/server.test.js`

- [ ] **Step 1: Rewrite server tests with new failing tests**

Replace all test cases in `tests/server.test.js` (keep the top boilerplate: requires, beforeAll, afterAll, beforeEach, URL, and `connect()` helper). Add a `createRoom` test helper and the following tests:

```js
// Test helper: creates a room and resolves with { socket, roomCode }
function createRoom(name, isPublic = true) {
  return connect().then((s) => new Promise((resolve) => {
    s.on('room-created', ({ roomCode }) => resolve({ socket: s, roomCode }));
    s.emit('create-room', { name, isPublic });
  }));
}

test('server accepts connections', (done) => {
  const s = ioClient(URL);
  s.on('connect', () => { expect(s.connected).toBe(true); s.disconnect(); done(); });
});

test('create-room emits room-created with a 6-char alphanumeric code', (done) => {
  createRoom('Alice').then(({ socket, roomCode }) => {
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);
    socket.disconnect();
    done();
  });
});

test('create-room emits lobby-state with creator as host', (done) => {
  connect().then((s) => {
    s.on('room-created', () => {});
    s.on('lobby-state', ({ players, hostId }) => {
      expect(players.some((p) => p.name === 'Bob')).toBe(true);
      expect(hostId).toBe(s.id);
      s.disconnect();
      done();
    });
    s.emit('create-room', { name: 'Bob', isPublic: true });
  });
});

test('join-room adds player and broadcasts lobby-state to whole room', (done) => {
  createRoom('Host').then(({ socket: host, roomCode }) => {
    connect().then((joiner) => {
      joiner.on('lobby-state', ({ players }) => {
        expect(players.length).toBe(2);
        host.disconnect(); joiner.disconnect();
        done();
      });
      joiner.emit('join-room', { roomCode, name: 'Joiner' });
    });
  });
});

test('join-room with duplicate name emits room-error', (done) => {
  createRoom('Alice').then(({ socket: s1, roomCode }) => {
    connect().then((s2) => {
      s2.on('room-error', ({ message }) => {
        expect(message).toMatch(/taken/i);
        s1.disconnect(); s2.disconnect();
        done();
      });
      s2.emit('join-room', { roomCode, name: 'Alice' });
    });
  });
});

test('join-room with unknown code emits room-error', (done) => {
  connect().then((s) => {
    s.on('room-error', ({ message }) => {
      expect(message).toMatch(/not found/i);
      s.disconnect();
      done();
    });
    s.emit('join-room', { roomCode: 'XXXXXX', name: 'Alice' });
  });
});

test('game-list includes public lobby rooms only', (done) => {
  connect().then((observer) => {
    observer.on('game-list', (list) => {
      expect(Array.isArray(list)).toBe(true);
      list.forEach((r) => {
        expect(r.roomCode).toBeDefined();
        expect(typeof r.playerCount).toBe('number');
      });
      observer.disconnect();
      done();
    });
    // Creating a public room triggers broadcastGameList
    createRoom('Host', true).then(() => {});
  });
});

test('game-list excludes private rooms', (done) => {
  connect().then((observer) => {
    let received = false;
    observer.on('game-list', (list) => {
      if (!received) {
        received = true;
        // Private room must not appear
        expect(list.length).toBe(0);
        observer.disconnect();
        done();
      }
    });
    createRoom('Host', false).then(() => {});
  });
});

test('room is deleted when last player disconnects', (done) => {
  createRoom('Solo').then(({ socket, roomCode }) => {
    connect().then((observer) => {
      let created = false;
      observer.on('game-list', (list) => {
        if (!created) { created = true; return; } // skip first broadcast (room exists)
        const stillThere = list.some((r) => r.roomCode === roomCode);
        if (!stillThere) { observer.disconnect(); done(); }
      });
      socket.disconnect();
    });
  });
});

test('join-room while game is playing emits room-error', (done) => {
  createRoom('Host').then(({ socket: host, roomCode }) => {
    host.emit('start-game', { map: 'A' });
    setTimeout(() => {
      connect().then((late) => {
        late.on('room-error', ({ message }) => {
          expect(message).toMatch(/in progress/i);
          host.disconnect(); late.disconnect();
          done();
        });
        late.emit('join-room', { roomCode, name: 'Latecomer' });
      });
    }, 100);
  });
});
```

- [ ] **Step 2: Run tests — verify they all fail**

```bash
npm test -- tests/server.test.js
```
Expected: failures on every test except "server accepts connections"

- [ ] **Step 3: Add room infrastructure to server.js**

Add the following block immediately after the `require(...)` statements and before the `// ── Constants` comment:

```js
// ── Room management ────────────────────────────────────────────────────────
const rooms = new Map();        // roomCode → Room
const socketToRoom = new Map(); // socket.id → roomCode

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function makeRoom(isPublic) {
  const code = generateRoomCode();
  return {
    code,
    isPublic,
    lobby: { players: [], hostId: null },
    gameState: null,
    gamePhase: 'lobby',
    gameLoopInterval: null,
    waypoints: [],
    nextBotNum: 1,
  };
}

function broadcastLobbyState(room) {
  io.to(room.code).emit('lobby-state', {
    players: room.lobby.players.map(({ id, name }) => ({ id, name })),
    hostId: room.lobby.hostId,
  });
}

function broadcastGameList() {
  const list = [];
  for (const room of rooms.values()) {
    if (room.isPublic && room.gamePhase === 'lobby') {
      list.push({ roomCode: room.code, playerCount: room.lobby.players.length });
    }
  }
  io.emit('game-list', list);
}
```

- [ ] **Step 4: Remove old module-level game globals and old broadcastLobbyState**

Delete these lines from server.js:
```js
let lobby = { players: [], hostId: null, waitingPlayers: [] };
let gameState = null;
let gamePhase = 'lobby';
let waypoints = [];
let gameLoopInterval = null;
let nextBotNum = 1;
```
And delete the old `function broadcastLobbyState()` (the one that calls `io.to('lobby').emit(...)`).

- [ ] **Step 5: Update `_resetForTesting()`**

Replace the existing `_resetForTesting` body with:

```js
function _resetForTesting() {
  for (const room of rooms.values()) {
    if (room.gameLoopInterval) clearInterval(room.gameLoopInterval);
  }
  rooms.clear();
  socketToRoom.clear();
}
```

- [ ] **Step 6: Replace the entire `io.on('connection', ...)` block**

Delete everything from `io.on('connection', (socket) => {` through its closing `});`, and replace with:

```js
io.on('connection', (socket) => {

  socket.on('create-room', ({ name, isPublic }) => {
    const n = (name || '').trim().slice(0, 16);
    if (!n) return;
    const room = makeRoom(!!isPublic);
    rooms.set(room.code, room);
    room.lobby.players.push({ id: socket.id, name: n });
    room.lobby.hostId = socket.id;
    socketToRoom.set(socket.id, room.code);
    socket.join(room.code);
    socket.emit('room-created', { roomCode: room.code });
    broadcastLobbyState(room);
    broadcastGameList();
  });

  socket.on('join-room', ({ roomCode, name }) => {
    const n = (name || '').trim().slice(0, 16);
    if (!n) return socket.emit('room-error', { message: 'Name required' });
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('room-error', { message: 'Room not found' });
    if (room.gamePhase !== 'lobby')
      return socket.emit('room-error', { message: 'Game already in progress' });
    if (room.lobby.players.some((p) => p.name === n))
      return socket.emit('room-error', { message: 'Name already taken' });
    room.lobby.players.push({ id: socket.id, name: n });
    socketToRoom.set(socket.id, room.code);
    socket.join(room.code);
    broadcastLobbyState(room);
    broadcastGameList();
  });

  socket.on('start-game', ({ map }) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || socket.id !== room.lobby.hostId || !MAPS[map]) return;
    startGame(map, room);
  });

  socket.on('input', (payload) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || !room.gameState) return;
    const tank = room.gameState.tanks.get(socket.id);
    if (tank && tank.hp > 0) {
      const raw = payload.keys ?? payload;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        tank.inputKeys = raw;
      }
    }
  });

  socket.on('disconnect', () => {
    const roomCode = socketToRoom.get(socket.id);
    socketToRoom.delete(socket.id);
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    room.lobby.players = room.lobby.players.filter((p) => p.id !== socket.id);
    if (room.gameState) room.gameState.tanks.delete(socket.id);

    if (socket.id === room.lobby.hostId) {
      room.lobby.hostId = room.lobby.players.length > 0 ? room.lobby.players[0].id : null;
    }

    if (room.lobby.players.length === 0) {
      if (room.gameLoopInterval) clearInterval(room.gameLoopInterval);
      rooms.delete(roomCode);
      broadcastGameList();
      return;
    }

    if (room.gamePhase === 'lobby') {
      broadcastLobbyState(room);
      broadcastGameList();
    }
  });
});
```

- [ ] **Step 7: Update `startGame` to accept a room parameter**

Replace `function startGame(mapKey)` with:

```js
function startGame(mapKey, room) {
  room.gamePhase = 'playing';
  room.nextBotNum = 1;
  const map = MAPS[mapKey];
  room.gameState = createGameState(map);
  room.waypoints = generateWaypoints(map.grid);

  for (const player of room.lobby.players) {
    spawnTank(room.gameState, player.id, player.name, false);
  }

  const botsNeeded = Math.max(0, MIN_TOTAL_TANKS - room.lobby.players.length);
  for (let i = 0; i < botsNeeded; i++) {
    const botId = 'bot-' + room.nextBotNum;
    spawnTank(room.gameState, botId, 'Bot' + room.nextBotNum, true);
    room.nextBotNum++;
  }

  io.to(room.code).emit('game-start', { map: mapKey });
  io.to(room.code).emit('map-data', { grid: map.grid });

  room.gameLoopInterval = setInterval(() => gameTick(room), TICK_MS);
  broadcastGameList();
}
```

- [ ] **Step 8: Update `gameTick` to accept a room parameter**

Change the signature to `function gameTick(room)` and replace every reference to the old module-level globals:

| Old reference | New reference |
|---------------|---------------|
| `gameState` | `room.gameState` |
| `waypoints` | `room.waypoints` |
| `io.emit('game-state', ...)` | `io.to(room.code).emit('game-state', ...)` |

At the point where `winner` is detected inside `gameTick`, replace the existing win-handling block with:

```js
if (winner) {
  clearInterval(room.gameLoopInterval);
  room.gameLoopInterval = null;
  io.to(room.code).emit('game-over', { winner });
  // Reset room to lobby state — code and players persist
  room.gamePhase = 'lobby';
  room.gameState = null;
  room.waypoints = [];
  room.nextBotNum = 1;
  broadcastGameList();
  broadcastLobbyState(room);
  return;
}
```

- [ ] **Step 9: Run all tests**

```bash
npm test -- tests/server.test.js
```
Expected: all tests PASS

- [ ] **Step 10: Commit**

```bash
git add server.js tests/server.test.js
git commit -m "feat: refactor server to multi-room with Room objects and create-room/join-room events"
```

---

## Phase 2: Client Changes

### Task 2: Update network.js

**Files:**
- Modify: `public/network.js`

- [ ] **Step 1: Replace the full contents of `public/network.js`**

```js
// Thin Socket.io client wrapper. Exposes a global `Network` object.
// Scripts must load socket.io client before this file.

const Network = (() => {
  let socket = null;
  const handlers = {};

  function on(event, fn) { handlers[event] = fn; }

  function connect() {
    socket = io();
    [
      'lobby-state', 'game-state', 'game-over', 'game-start',
      'map-data', 'name-error',
      'room-created', 'room-error', 'game-list',
    ].forEach((evt) => {
      socket.on(evt, (data) => { if (handlers[evt]) handlers[evt](data); });
    });
  }

  function createRoom(name, isPublic) {
    if (socket) socket.emit('create-room', { name, isPublic });
  }
  function joinRoom(roomCode, name) {
    if (socket) socket.emit('join-room', { roomCode, name });
  }
  function startGame(map) { if (socket) socket.emit('start-game', { map }); }
  function sendInput(keys) { if (socket) socket.emit('input', keys); }
  function getId() { return socket ? socket.id : null; }

  return { connect, createRoom, joinRoom, startGame, sendInput, on, getId };
})();
```

- [ ] **Step 2: Smoke test**

```bash
npm start
```

Open `http://localhost:3000` in a browser. Verify no JS errors in the console. The page will look broken (HTML not updated yet) — that's expected.

- [ ] **Step 3: Commit**

```bash
git add public/network.js
git commit -m "feat: update network.js — createRoom, joinRoom, new events, remove waiting"
```

---

### Task 3: Update index.html screens and inline script

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Replace the CSS `<style>` block**

Replace the full contents of the existing `<style>` block (inside `<head>`) with:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #000; color: #0f0; font-family: monospace;
       display: flex; align-items: center; justify-content: center;
       min-height: 100vh; }

/* ── Shared screen styles ── */
.screen { display: none; text-align: center; max-width: 420px; width: 100%; padding: 20px; }
.screen.active { display: block; }
#game.screen.active { display: flex; flex-direction: column; align-items: center; }
#browser.screen { max-width: 540px; }

h1 { font-size: 2rem; letter-spacing: 4px; margin-bottom: 4px; }
.sub { opacity: 0.5; font-size: 0.8rem; margin-bottom: 24px; }

input[type=text] { background: #000; border: 1px solid #0f0; color: #0f0;
  font-family: monospace; font-size: 1rem; padding: 8px 12px;
  width: 100%; margin-bottom: 10px; outline: none; }
input[type=text]:focus { box-shadow: 0 0 8px rgba(0,255,0,0.3); }

button { background: #000; border: 1px solid #0f0; color: #0f0;
  font-family: monospace; font-size: 1rem; padding: 8px 24px;
  cursor: pointer; margin: 4px; }
button:hover { background: rgba(0,255,0,0.1); }
button.secondary { border-color: rgba(0,255,0,0.4); color: rgba(0,255,0,0.6); }

#error { color: #f44; font-size: 0.85rem; min-height: 16px; margin-bottom: 6px; }

/* ── Landing ── */
#join-row { display: flex; gap: 6px; margin-top: 8px; }
#join-row input { flex: 1; margin-bottom: 0; }

/* ── Browser ── */
#game-list-items { margin: 16px 0; text-align: left; min-height: 60px; }
.game-item { display: flex; align-items: center; justify-content: space-between;
             padding: 8px 0; border-bottom: 1px solid rgba(0,255,0,0.2); }
.game-item-info { font-size: 0.85rem; opacity: 0.7; }

/* ── Lobby ── */
#room-code-display { opacity: 0.45; font-size: 0.75rem; letter-spacing: 3px; margin-bottom: 14px; }
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

/* ── Game ── */
#game-area { display: flex; border: 1px solid #0f0; }
#game-canvas { display: block; }
#minimap { width: 128px; height: 128px; align-self: flex-start; margin-top: 176px;
           border-left: 1px solid rgba(0,255,0,0.3); }
#hud { width: 769px; height: 28px;
       border-top: 1px solid rgba(0,255,0,0.3); background: #000; }

/* ── Overlay ── */
#overlay { display: none; position: fixed; inset: 0;
           background: rgba(0,0,0,0.88);
           align-items: center; justify-content: center;
           flex-direction: column; text-align: center; z-index: 10; }
#overlay h2 { font-size: 2rem; margin-bottom: 12px; }
#overlay p { opacity: 0.6; }

/* ── Mute button ── */
#mute-btn { position: fixed; top: 8px; right: 8px; z-index: 20;
            background: #000; border: 1px solid rgba(0,255,0,0.4);
            color: rgba(0,255,0,0.6); font-family: monospace;
            font-size: 0.75rem; padding: 4px 8px; cursor: pointer; }
#mute-btn:hover { border-color: #0f0; color: #0f0; }
```

- [ ] **Step 2: Replace the `<body>` HTML (before the `<script>` tags)**

Replace everything between `<body>` and `<script src="/socket.io/socket.io.js">` with:

```html
<button id="mute-btn">SFX: ON</button>

<!-- Screen: Landing -->
<div id="landing" class="screen active">
  <h1>SPECTRE</h1>
  <p class="sub">Tank Combat</p>
  <input id="name-input" type="text" maxlength="16" placeholder="Enter your name" autofocus>
  <div id="error"></div>
  <button id="create-public-btn">CREATE PUBLIC GAME</button>
  <button id="create-private-btn" class="secondary">CREATE PRIVATE GAME</button>
  <button id="browse-btn">BROWSE GAMES</button>
  <div id="join-row">
    <input id="code-input" type="text" maxlength="6" placeholder="ROOM CODE">
    <button id="join-code-btn">JOIN</button>
  </div>
</div>

<!-- Screen: Game Browser -->
<div id="browser" class="screen">
  <h1>OPEN GAMES</h1>
  <div id="game-list-items"></div>
  <button id="back-from-browser-btn" class="secondary">BACK</button>
</div>

<!-- Screen: Lobby -->
<div id="lobby" class="screen">
  <h1>SPECTRE</h1>
  <div id="room-code-display"></div>
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
  <button id="leave-btn" class="secondary" style="margin-top:20px">LEAVE ROOM</button>
</div>

<!-- Screen: Game -->
<div id="game" class="screen">
  <div id="game-area">
    <canvas id="game-canvas" width="640" height="480"></canvas>
    <canvas id="minimap" width="128" height="128"></canvas>
  </div>
  <canvas id="hud" width="769" height="28"></canvas>
</div>

<!-- Overlay: Game Over -->
<div id="overlay">
  <h2 id="overlay-title">GAME OVER</h2>
  <p id="overlay-sub">Returning to lobby...</p>
</div>

```

- [ ] **Step 3: Replace the inline `<script>` block**

Replace everything from `let myId = null;` through the end `</script>` with:

```js
  let myId = null;
  let myName = null;
  let currentGrid = null;
  let currentRoomCode = null;

  Game.init(
    document.getElementById('game-canvas'),
    document.getElementById('minimap'),
    document.getElementById('hud')
  );
  Network.connect();

  // ── Helpers ───────────────────────────────────────────────────────────────
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }
  function showError(msg) { document.getElementById('error').textContent = msg; }
  function getName() { return document.getElementById('name-input').value.trim(); }

  // ── Landing ───────────────────────────────────────────────────────────────
  document.getElementById('create-public-btn').addEventListener('click', () => {
    const name = getName();
    if (!name) { showError('Enter a name first'); return; }
    Sound.unlock();
    Network.createRoom(name, true);
  });

  document.getElementById('create-private-btn').addEventListener('click', () => {
    const name = getName();
    if (!name) { showError('Enter a name first'); return; }
    Sound.unlock();
    Network.createRoom(name, false);
  });

  document.getElementById('browse-btn').addEventListener('click', () => {
    showScreen('browser');
  });

  document.getElementById('join-code-btn').addEventListener('click', () => {
    const name = getName();
    const code = document.getElementById('code-input').value.trim().toUpperCase();
    if (!name) { showError('Enter a name first'); return; }
    if (!code) { showError('Enter a room code'); return; }
    Sound.unlock();
    Network.joinRoom(code, name);
  });

  document.getElementById('name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('join-code-btn').click();
  });

  // ── Browser ───────────────────────────────────────────────────────────────
  document.getElementById('back-from-browser-btn').addEventListener('click', () => {
    showScreen('landing');
  });

  Network.on('game-list', (list) => {
    const container = document.getElementById('game-list-items');
    while (container.firstChild) container.removeChild(container.firstChild);

    if (list.length === 0) {
      const p = document.createElement('p');
      p.style.opacity = '0.4';
      p.textContent = 'No open games — create one!';
      container.appendChild(p);
      return;
    }

    list.forEach(({ roomCode, playerCount }) => {
      const div = document.createElement('div');
      div.className = 'game-item';

      const info = document.createElement('span');
      info.className = 'game-item-info';
      info.textContent = roomCode + ' \u00B7 ' + playerCount + ' player' + (playerCount !== 1 ? 's' : '');

      const btn = document.createElement('button');
      btn.textContent = 'JOIN';
      btn.addEventListener('click', () => {
        const name = getName();
        if (!name) { showScreen('landing'); showError('Enter a name first'); return; }
        Sound.unlock();
        Network.joinRoom(roomCode, name);
      });

      div.appendChild(info);
      div.appendChild(btn);
      container.appendChild(div);
    });
  });

  // ── Room events ───────────────────────────────────────────────────────────
  Network.on('room-created', ({ roomCode }) => {
    currentRoomCode = roomCode;
    myName = getName();
    showScreen('lobby');
  });

  Network.on('room-error', ({ message }) => {
    showError(message);
    showScreen('landing');
  });

  Network.on('name-error', ({ message }) => showError(message));

  // ── Lobby ─────────────────────────────────────────────────────────────────
  Network.on('lobby-state', ({ players, hostId }) => {
    myId = Network.getId();
    const me = players.find((p) => p.id === myId);
    if (me) myName = me.name;
    const isHost = myId === hostId;

    document.getElementById('room-code-display').textContent =
      currentRoomCode ? 'ROOM: ' + currentRoomCode : '';
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

    showScreen('lobby');
  });

  document.getElementById('start-btn').addEventListener('click', () => {
    Network.startGame(document.getElementById('map-sel').value);
  });

  document.getElementById('leave-btn').addEventListener('click', () => {
    location.reload(); // Simplest leave: full reload returns to landing screen
  });

  // ── Game ──────────────────────────────────────────────────────────────────
  Network.on('map-data', ({ grid }) => { currentGrid = grid; });

  Network.on('game-start', () => {
    myId = Network.getId();
    showScreen('game');
    Game.start(myId);
  });

  Network.on('game-state', (state) => {
    state.grid = currentGrid;
    Game.onGameState(state);
  });

  Network.on('game-over', ({ winner }) => {
    Game.stop();
    Sound.victory();
    document.getElementById('overlay-title').textContent =
      (winner === myName) ? 'YOU WIN!' : winner + ' WINS!';
    document.getElementById('overlay').style.display = 'flex';

    setTimeout(() => {
      currentGrid = null;
      document.getElementById('overlay').style.display = 'none';
      showScreen('lobby'); // room persists — return to lobby, not landing
    }, 5000);
  });

  // ── Mute ──────────────────────────────────────────────────────────────────
  document.getElementById('mute-btn').addEventListener('click', () => {
    Sound.unlock();
    Sound.setEnabled(!Sound.isEnabled());
    document.getElementById('mute-btn').textContent =
      Sound.isEnabled() ? 'SFX: ON' : 'SFX: OFF';
  });
```

- [ ] **Step 4: Full manual end-to-end test**

```bash
npm start
```

Open two browser tabs at `http://localhost:3000`. Verify the complete flow:

1. Tab 1: landing screen, enter name → click **CREATE PUBLIC GAME** → lands in lobby, room code visible
2. Tab 2: landing screen → click **BROWSE GAMES** → Tab 1's room appears in the list
3. Tab 2: enter a different name, click **JOIN** on the listed room → both tabs show lobby with 2 players
4. Tab 1 (host): click **START GAME** → both tabs enter game, renderer and minimap work
5. Play until someone wins → both tabs see GAME OVER overlay → return to lobby after 5 seconds
6. Click **LEAVE ROOM** → reloads to landing screen

Also test: enter a name, type a fake room code in the JOIN field → room-error message appears.

- [ ] **Step 5: Run all tests**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: add landing, browser, and lobby screens with multi-room UI"
```

---

## Phase 3: Infrastructure

### Task 4: Launch EC2 instance

- [ ] **Step 1: Launch EC2 in AWS Console**

  - Region: `us-east-1`
  - AMI: **Ubuntu Server 22.04 LTS** (64-bit x86)
  - Instance type: `t3.micro`
  - Key pair: create or select → download `.pem` file
  - Security Group inbound rules:
    - SSH port 22 — from My IP
    - HTTP port 80 — from Anywhere (0.0.0.0/0, ::/0)
    - HTTPS port 443 — from Anywhere (0.0.0.0/0, ::/0)
  - Storage: 8 GB gp3 (default)
  - Launch

- [ ] **Step 2: Allocate and attach Elastic IP**

  EC2 Console → Elastic IPs → Allocate Elastic IP address → Allocate.
  Select the new IP → Actions → Associate → select your instance → Associate.
  Note the IP address — needed for the Cloudflare DNS record.

- [ ] **Step 3: SSH into instance**

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<elastic-ip>
```

- [ ] **Step 4: Install Node.js 20 LTS**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # expected: v20.x.x
```

- [ ] **Step 5: Install PM2 and nginx**

```bash
sudo npm install -g pm2
sudo apt-get install -y nginx
```

- [ ] **Step 6: Clone repo and install dependencies**

```bash
cd ~
git clone https://github.com/mvanemmerik/tanks.git
cd tanks
npm install --production
```

- [ ] **Step 7: Start app with PM2 and enable boot persistence**

```bash
pm2 start server.js --name game
pm2 save
pm2 startup   # copy and run the printed sudo env command
```

- [ ] **Step 8: Verify Node is running**

```bash
pm2 status          # game should show 'online'
curl http://localhost:3000   # expected: HTML response
```

---

### Task 5: nginx + Cloudflare Origin Certificate

- [ ] **Step 1: Generate Cloudflare Origin Certificate**

  Cloudflare dashboard → vanemmerik.ai → SSL/TLS → Origin Server → **Create Certificate**
  - Hostnames: `*.vanemmerik.ai, vanemmerik.ai` (covers `tanks.vanemmerik.ai`)
  - Key type: RSA (2048), Validity: 15 years
  - Click Create → copy the **Origin Certificate** (PEM) and **Private Key** (shown once only)

- [ ] **Step 2: Install cert on EC2**

```bash
sudo mkdir -p /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/tanks.vanemmerik.ai.pem   # paste Origin Certificate, save
sudo nano /etc/ssl/cloudflare/tanks.vanemmerik.ai.key   # paste Private Key, save
sudo chmod 644 /etc/ssl/cloudflare/tanks.vanemmerik.ai.pem
sudo chmod 600 /etc/ssl/cloudflare/tanks.vanemmerik.ai.key
```

- [ ] **Step 3: Write nginx site config**

```bash
sudo nano /etc/nginx/sites-available/tanks
```

Paste exactly:

```nginx
server {
    listen 443 ssl;
    server_name tanks.vanemmerik.ai;

    ssl_certificate     /etc/ssl/cloudflare/tanks.vanemmerik.ai.pem;
    ssl_certificate_key /etc/ssl/cloudflare/tanks.vanemmerik.ai.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
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

- [ ] **Step 4: Enable site and reload nginx**

```bash
sudo ln -s /etc/nginx/sites-available/tanks /etc/nginx/sites-enabled/
sudo nginx -t           # expected: syntax is ok / test is successful
sudo systemctl reload nginx
```

---

### Task 6: Cloudflare DNS + smoke test

- [ ] **Step 1: Add DNS A record**

  Cloudflare → vanemmerik.ai → DNS → Add record:
  - Type: **A**, Name: `tanks`, IPv4: `<elastic-ip>`
  - Proxy status: **Proxied** (orange cloud), TTL: Auto → Save

- [ ] **Step 2: Set SSL/TLS mode to Full**

  Cloudflare → vanemmerik.ai → SSL/TLS → Overview → select **Full**
  (not Flexible — breaks WebSocket upgrades; not Full Strict — Origin Certificate is not a public CA cert)

- [ ] **Step 3: Smoke test**

  Open `https://tanks.vanemmerik.ai` in a browser.

  Verify:
  - Landing screen loads with valid SSL (Cloudflare cert icon in browser)
  - No errors in browser DevTools console
  - Open two tabs, create and join a game — confirm the full multi-room flow works live

- [ ] **Step 4: Push code and record deployment**

  On your local machine:

```bash
git push origin main
```

---

## Ongoing Deploy Workflow

After any code change, deploy from your local machine:

```bash
ssh -i your-key.pem ubuntu@<elastic-ip> "cd ~/tanks && git pull && npm install --production && pm2 restart game"
```

~30 seconds total, ~2 seconds of downtime during `pm2 restart`.
