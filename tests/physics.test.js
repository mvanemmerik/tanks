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
