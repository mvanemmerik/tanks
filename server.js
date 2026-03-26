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
