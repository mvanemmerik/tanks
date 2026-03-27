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

// ── Constants ──────────────────────────────────────────────────────────────
const MOVE_SPEED = 4;
const TURN_SPEED = Math.PI / 30;
const PROJECTILE_SPEED = 20;
const PROJECTILE_MAX_RANGE = 512;
const SHOOT_COOLDOWN = 500;
const RESPAWN_DELAY = 2000;
const TICK_MS = 50;
const MIN_TOTAL_TANKS = 4;

// Resets all mutable server state — used by tests to avoid cross-test contamination
function _resetForTesting() {
  for (const room of rooms.values()) {
    if (room.gameLoopInterval) clearInterval(room.gameLoopInterval);
  }
  rooms.clear();
  socketToRoom.clear();
}

// ── Socket.io ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // Send current public lobby list to newly connected socket
  const initialList = [];
  for (const room of rooms.values()) {
    if (room.isPublic && room.gamePhase === 'lobby') {
      initialList.push({ roomCode: room.code, playerCount: room.lobby.players.length });
    }
  }
  socket.emit('game-list', initialList);

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
      // Deferred broadcast ensures sockets completing their handshake concurrently also receive the update
      setImmediate(broadcastGameList);
      return;
    }

    if (room.gamePhase === 'lobby') {
      broadcastLobbyState(room);
      broadcastGameList();
    }
  });
});

// ── Game loop ──────────────────────────────────────────────────────────────
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

function gameTick(room) {
  const now = Date.now();
  const map = room.gameState.map;

  // Tick bots
  const humanTanks = Array.from(room.gameState.tanks.values()).filter((t) => !t.isBot && t.hp > 0);
  for (const tank of room.gameState.tanks.values()) {
    if (tank.isBot && tank.hp > 0) tickBot(tank, humanTanks, room.waypoints, map.grid, now);
  }

  // Apply input and physics for all tanks
  for (const tank of room.gameState.tanks.values()) {
    if (tank.hp <= 0) continue;
    const { w, a, s, d, space } = tank.inputKeys;

    if (a) tank.angle = applyTurn(tank.angle, -TURN_SPEED);
    if (d) tank.angle = applyTurn(tank.angle, TURN_SPEED);
    if (w) { const m = applyMovement(tank.x, tank.y, tank.angle, MOVE_SPEED, map.grid); tank.x = m.x; tank.y = m.y; }
    if (s) { const m = applyMovement(tank.x, tank.y, tank.angle, -MOVE_SPEED, map.grid); tank.x = m.x; tank.y = m.y; }

    if (space && now - tank.lastShot >= SHOOT_COOLDOWN) {
      tank.lastShot = now;
      createProjectile(room.gameState, tank.id, tank.x, tank.y, tank.angle);
    }
  }

  // Move projectiles and check collisions
  const toRemove = [];
  for (const proj of room.gameState.projectiles.values()) {
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

    for (const tank of room.gameState.tanks.values()) {
      if (tank.id === proj.ownerId || tank.hp <= 0) continue;
      const dx = tank.x - proj.x;
      const dy = tank.y - proj.y;
      if (Math.sqrt(dx * dx + dy * dy) < 20) {
        tank.hp -= 25;
        toRemove.push(proj.id);
        if (tank.hp <= 0) {
          tank.hp = 0;
          addKill(room.gameState, proj.ownerId);
          const deadId = tank.id;
          const deadName = tank.name;
          const isBot = tank.isBot;
          setTimeout(() => {
            if (room.gamePhase === 'playing' && room.gameState && room.gameState.tanks.has(deadId)) {
              spawnTank(room.gameState, deadId, deadName, isBot);
            }
          }, RESPAWN_DELAY);
        }
        break;
      }
    }
  }
  toRemove.forEach((id) => room.gameState.projectiles.delete(id));

  const winner = checkWinCondition(room.gameState);
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

  // Broadcast to active players only
  const tanks = Array.from(room.gameState.tanks.values())
    .map(({ id, name, x, y, angle, hp, isBot }) => ({ id, name, x, y, angle, hp, isBot }));
  const projectiles = Array.from(room.gameState.projectiles.values())
    .map(({ id, ownerId, x, y, angle }) => ({ id, ownerId, x, y, angle }));
  const scores = Object.fromEntries(room.gameState.scores);

  io.to(room.code).emit('game-state', { tanks, projectiles, scores });
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

module.exports = { app, server, io, _resetForTesting };
