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
