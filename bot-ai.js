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
    bot.noTargetTimer = 0;  // keep for backward compat
    bot.lastTargetSeenAt = 0;  // reset when target is visible

    // Spec: engage state — turn to face and shoot, no forward movement
    // Turn toward target (capped at TURN_SPEED per tick)
    const desiredAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
    const diff = shortestAngleDiff(bot.angle, desiredAngle);
    if (Math.abs(diff) > TURN_SPEED) {
      bot.angle = applyTurn(bot.angle, diff > 0 ? TURN_SPEED : -TURN_SPEED);
    }

    // Shoot if roughly aligned and cooldown expired
    if (Math.abs(diff) < Math.PI / 6 && now - bot.lastShot >= SHOOT_COOLDOWN) {
      bot.inputKeys.space = true;
      bot.lastShot = now;
    }
  } else {
    if (bot.aiState === 'engage') {
      if (!bot.lastTargetSeenAt) bot.lastTargetSeenAt = now;
      if (now - bot.lastTargetSeenAt >= NO_TARGET_TIMEOUT) {
        bot.aiState = 'roam';
        bot.currentWaypoint = null;
        bot.lastTargetSeenAt = 0;
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
