const CELL_SIZE = 64;
const TANK_RADIUS = 16;

function isWall(x, y, grid) {
  const col = Math.floor(x / CELL_SIZE);
  const row = Math.floor(y / CELL_SIZE);
  if (col < 0 || row < 0 || row >= grid.length || col >= grid[0].length) return true;
  return grid[row][col] === 1;
}

// Check 4 cardinal extremes of the tank's collision circle
// NOTE: 4-point probe approximates a circle. Diagonal corner penetration is
// possible; acceptable for this game's speed and cell size.
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

  const deltaDistX = dirX === 0 ? Infinity : Math.abs(CELL_SIZE / dirX);
  const deltaDistY = dirY === 0 ? Infinity : Math.abs(CELL_SIZE / dirY);

  let sideDistX = dirX === 0 ? Infinity
    : dirX < 0
      ? (x1 - mapX * CELL_SIZE) * Math.abs(1 / dirX)
      : ((mapX + 1) * CELL_SIZE - x1) * Math.abs(1 / dirX);
  let sideDistY = dirY === 0 ? Infinity
    : dirY < 0
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
