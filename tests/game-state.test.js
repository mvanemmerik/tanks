const {
  createGameState, selectSpawnPoint, spawnTank,
  addKill, checkWinCondition, reserveSpawn, createProjectile,
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
