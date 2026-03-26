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
  CELL_SIZE,
  MAX_HP,
  WIN_KILLS,
  RESPAWN_RESERVE_MS,
};
