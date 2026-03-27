// DDA raycasting renderer. Exposes a global `Renderer` object.
// Renders wireframe walls, tank/projectile sprites, and minimap.

const Renderer = (() => {
  const CELL_SIZE = 64;
  const FOV = 66 * Math.PI / 180;
  const HALF_FOV = FOV / 2;
  const CANVAS_W = 640;
  const CANVAS_H = 480;
  const MAX_DIST = 8 * CELL_SIZE;
  const GREEN = '#00ff00';

  let ctx, mapCtx;
  let zBuffer = new Float32Array(CANVAS_W);

  function init(gameCanvas, minimapCanvas) {
    ctx = gameCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    mapCtx = minimapCanvas.getContext('2d');
    mapCtx.imageSmoothingEnabled = false;
  }

  // DDA ray cast. Returns { dist, side, mapX, mapY }.
  function castRay(px, py, angle, grid) {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    let mapX = Math.floor(px / CELL_SIZE);
    let mapY = Math.floor(py / CELL_SIZE);

    const deltaDistX = Math.abs(CELL_SIZE / dirX);
    const deltaDistY = Math.abs(CELL_SIZE / dirY);

    let sideDistX = (dirX < 0
      ? (px - mapX * CELL_SIZE)
      : ((mapX + 1) * CELL_SIZE - px)) * Math.abs(1 / dirX);
    let sideDistY = (dirY < 0
      ? (py - mapY * CELL_SIZE)
      : ((mapY + 1) * CELL_SIZE - py)) * Math.abs(1 / dirY);

    const stepX = dirX < 0 ? -1 : 1;
    const stepY = dirY < 0 ? -1 : 1;
    let side = 0;
    let iters = 0;

    while (iters++ < 64) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX; mapX += stepX; side = 0;
      } else {
        sideDistY += deltaDistY; mapY += stepY; side = 1;
      }
      if (mapY < 0 || mapY >= grid.length || mapX < 0 || mapX >= grid[0].length) break;
      if (grid[mapY][mapX] === 1) break;
    }

    // Perpendicular distance (corrects fisheye)
    const dist = side === 0
      ? (sideDistX - deltaDistX)
      : (sideDistY - deltaDistY);

    return { dist: Math.max(1, dist), side, mapX, mapY };
  }

  function render(player, tanks, projectiles, grid) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const prevHits = new Array(CANVAS_W);

    for (let col = 0; col < CANVAS_W; col++) {
      const rayAngle = player.angle - HALF_FOV + (col / CANVAS_W) * FOV;
      const hit = castRay(player.x, player.y, rayAngle, grid);
      zBuffer[col] = hit.dist;

      const wallH = Math.min(CANVAS_H, Math.floor(CELL_SIZE * CANVAS_H / hit.dist));
      const top = Math.floor((CANVAS_H - wallH) / 2);
      const bot = top + wallH;
      const alpha = Math.max(0.18, 1 - hit.dist / MAX_DIST);

      ctx.strokeStyle = `rgba(0,255,0,${alpha})`;
      ctx.lineWidth = 1;

      // Top edge
      ctx.beginPath(); ctx.moveTo(col, top); ctx.lineTo(col + 1, top); ctx.stroke();
      // Bottom edge
      ctx.beginPath(); ctx.moveTo(col, bot); ctx.lineTo(col + 1, bot); ctx.stroke();

      // Vertical edge where wall face changes
      if (col > 0 && prevHits[col - 1]) {
        const p = prevHits[col - 1];
        if (p.mapX !== hit.mapX || p.mapY !== hit.mapY || p.side !== hit.side) {
          ctx.beginPath(); ctx.moveTo(col, p.top); ctx.lineTo(col, top); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(col, p.bot); ctx.lineTo(col, bot); ctx.stroke();
        }
      }

      prevHits[col] = { mapX: hit.mapX, mapY: hit.mapY, side: hit.side, top, bot };
    }

    // Crosshair
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 1;
    const cx = CANVAS_W / 2, cy = CANVAS_H / 2;
    ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();

    // Sort sprites back-to-front
    const sprites = [];
    if (tanks) {
      for (const tank of tanks) {
        if (tank.id !== player.id && tank.hp > 0) sprites.push({ type: 'tank', obj: tank });
      }
    }
    if (projectiles) {
      for (const proj of projectiles) sprites.push({ type: 'proj', obj: proj });
    }
    sprites.sort((a, b) => {
      const da = (a.obj.x - player.x) ** 2 + (a.obj.y - player.y) ** 2;
      const db = (b.obj.x - player.x) ** 2 + (b.obj.y - player.y) ** 2;
      return db - da;
    });
    sprites.forEach(({ type, obj }) => drawSprite(player, obj, type));
  }

  function drawSprite(player, obj, type) {
    const dx = obj.x - player.x;
    const dy = obj.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 8) return;

    // Must be in front of player
    if (Math.cos(player.angle) * dx + Math.sin(player.angle) * dy <= 0) return;

    const spriteAngle = Math.atan2(dy, dx) - player.angle;
    const normAngle = ((spriteAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(normAngle) > HALF_FOV + 0.3) return;

    const screenX = Math.floor(CANVAS_W / 2 + Math.tan(normAngle) * (CANVAS_W / FOV));
    // Perpendicular (fisheye-corrected) depth — must match zBuffer's coordinate space
    const perpDist = Math.cos(normAngle) * dist;
    const alpha = Math.max(0.18, 1 - dist / MAX_DIST);

    if (type === 'tank') {
      const h = Math.min(CANVAS_H, Math.floor(CELL_SIZE * CANVAS_H / perpDist));
      const w = Math.floor(h * 0.75);
      const top = Math.floor((CANVAS_H - h) / 2);
      const left = screenX - Math.floor(w / 2);

      let visible = false;
      const c0 = Math.max(0, left);
      const c1 = Math.min(CANVAS_W - 1, left + w);
      for (let c = c0; c <= c1; c++) {
        if (perpDist < zBuffer[c]) { visible = true; break; }
      }
      if (!visible) return;

      ctx.fillStyle = `rgba(0,255,0,${alpha * 0.9})`;
      ctx.fillRect(left, top, w, h);
      ctx.strokeStyle = `rgba(0,0,0,${alpha * 0.6})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(screenX, top);
      ctx.lineTo(screenX, top - Math.floor(h * 0.25));
      ctx.stroke();

    } else {
      const size = Math.max(3, Math.floor(6 * CANVAS_H / perpDist));
      const cy = Math.floor(CANVAS_H / 2);

      let visible = false;
      const c0 = Math.max(0, screenX - 2);
      const c1 = Math.min(CANVAS_W - 1, screenX + 2);
      for (let c = c0; c <= c1; c++) {
        if (perpDist < zBuffer[c]) { visible = true; break; }
      }
      if (!visible) return;

      ctx.strokeStyle = `rgba(0,255,0,${alpha * 0.7})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(screenX, cy - size);
      ctx.lineTo(screenX + size, cy);
      ctx.lineTo(screenX, cy + size);
      ctx.lineTo(screenX - size, cy);
      ctx.closePath();
      ctx.stroke();
    }
  }

  function renderMinimap(player, tanks, grid) {
    const W = mapCtx.canvas.width;
    const H = mapCtx.canvas.height;
    const rows = grid.length;
    const cols = grid[0].length;
    const cw = W / cols;
    const ch = H / rows;

    mapCtx.fillStyle = '#000';
    mapCtx.fillRect(0, 0, W, H);

    // Walls
    mapCtx.fillStyle = 'rgba(0,255,0,0.35)';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 1) mapCtx.fillRect(c * cw, r * ch, cw, ch);
      }
    }

    // Other tanks
    if (tanks) {
      mapCtx.fillStyle = 'rgba(0,255,0,0.7)';
      for (const tank of tanks) {
        if (tank.id === player.id || tank.hp <= 0) continue;
        const tx = (tank.x / (cols * CELL_SIZE)) * W;
        const ty = (tank.y / (rows * CELL_SIZE)) * H;
        mapCtx.beginPath();
        mapCtx.arc(tx, ty, 2, 0, Math.PI * 2);
        mapCtx.fill();
      }
    }

    // Player dot + direction line
    const px = (player.x / (cols * CELL_SIZE)) * W;
    const py = (player.y / (rows * CELL_SIZE)) * H;
    mapCtx.fillStyle = GREEN;
    mapCtx.beginPath(); mapCtx.arc(px, py, 3, 0, Math.PI * 2); mapCtx.fill();
    mapCtx.strokeStyle = GREEN;
    mapCtx.lineWidth = 1.5;
    mapCtx.beginPath();
    mapCtx.moveTo(px, py);
    mapCtx.lineTo(px + Math.cos(player.angle) * 8, py + Math.sin(player.angle) * 8);
    mapCtx.stroke();
  }

  return { init, render, renderMinimap };
})();
