const {
  createGameState, selectSpawnPoint, spawnTank,
  addKill, checkWinCondition, reserveSpawn, createProjectile,
} = require('../game-state');
const { MAPS } = require('../maps');

function freshState() {
  return createGameState(MAPS['B']);
}

describe('createGameState', () => {
  test('initializes with empty tanks, projectiles, scores, and auxiliary maps', () => {
    const gs = freshState();
    expect(gs.tanks.size).toBe(0);
    expect(gs.projectiles.size).toBe(0);
    expect(gs.scores.size).toBe(0);
    expect(gs.nextProjectileId).toBe(0);
    expect(gs.spawnReservations.size).toBe(0);
    expect(gs.playerNames.size).toBe(0);
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
    for (let i = 0; i < gs.map.spawns.length; i++) {
      if (i !== 3) gs.spawnReservations.set(i, Date.now() + 5000);
    }
    const idx = selectSpawnPoint(gs, []);
    expect(idx).toBe(3);
  });

  test('falls back to soonest-expiring if all reserved', () => {
    const gs = freshState();
    const now = Date.now();
    for (let i = 0; i < gs.map.spawns.length; i++) {
      gs.spawnReservations.set(i, now + (i + 1) * 1000);
    }
    const idx = selectSpawnPoint(gs, []);
    expect(idx).toBe(0);
  });

  test('picks spawn farthest from enemies', () => {
    const gs = freshState();
    // Enemy near spawn index 0 ([1,1] -> world 96,96)
    const enemyPositions = [[96, 96]];
    const idx = selectSpawnPoint(gs, enemyPositions);
    // Spawn index 0 is at world (96, 96) — same as enemy, should NOT be chosen
    const [col, row] = gs.map.spawns[idx];
    const wx = col * 64 + 32;
    const wy = row * 64 + 32;
    // The chosen spawn should be farther from (96,96) than spawn 0 is
    const distChosen = Math.sqrt((wx - 96) ** 2 + (wy - 96) ** 2);
    expect(distChosen).toBeGreaterThan(0);
    // Specifically should NOT pick index 0 (the one right next to the enemy)
    expect(idx).not.toBe(0);
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

  test('does not reset score when same ID spawns again', () => {
    const gs = freshState();
    spawnTank(gs, 'sock1', 'Alice', false);
    gs.scores.set('sock1', 5);
    spawnTank(gs, 'sock1', 'Alice', false); // respawn
    expect(gs.scores.get('sock1')).toBe(5);
  });
});

describe('addKill', () => {
  test('increments score for killer', () => {
    const gs = freshState();
    spawnTank(gs, 'sock1', 'Alice', false);
    addKill(gs, 'sock1');
    expect(gs.scores.get('sock1')).toBe(1);
  });

  test('ignores kill for unknown player ID', () => {
    const gs = freshState();
    addKill(gs, 'ghost');
    expect(gs.scores.has('ghost')).toBe(false);
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

  test('returns winner name even when tank is dead (removed from tanks map)', () => {
    const gs = freshState();
    spawnTank(gs, 'sock1', 'Alice', false);
    gs.scores.set('sock1', 10);
    gs.tanks.delete('sock1');  // simulate death
    expect(checkWinCondition(gs)).toBe('Alice');
  });
});

describe('createProjectile', () => {
  test('creates projectile and increments nextProjectileId', () => {
    const gs = freshState();
    const p = createProjectile(gs, 'sock1', 100, 200, 1.5);
    expect(p.id).toBe(0);
    expect(p.ownerId).toBe('sock1');
    expect(p.x).toBe(100);
    expect(p.y).toBe(200);
    expect(p.angle).toBe(1.5);
    expect(p.distanceTraveled).toBe(0);
    expect(gs.nextProjectileId).toBe(1);
    expect(gs.projectiles.get(0)).toBe(p);
  });
});
