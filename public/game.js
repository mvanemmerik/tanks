// Client game loop. Exposes a global `Game` object.
// Depends on: Network, Renderer (loaded before this script).

const Game = (() => {
  const keys = { w: false, a: false, s: false, d: false, space: false };
  let hudCanvas, hudCtx;
  let localPlayerId = null;
  let lastGameState = null;
  let animFrame = null;
  let running = false;

  const keyMap = {
    'w': 'w', 'arrowup': 'w',
    's': 's', 'arrowdown': 's',
    'a': 'a', 'arrowleft': 'a',
    'd': 'd', 'arrowright': 'd',
    ' ': 'space',
  };

  function init(gameCanvas, minimapCanvas, hCanvas) {
    Renderer.init(gameCanvas, minimapCanvas);
    hudCanvas = hCanvas;
    hudCtx = hCanvas.getContext('2d');
    setupInput();
  }

  function setupInput() {
    document.addEventListener('keydown', (e) => {
      const k = keyMap[e.key.toLowerCase()];
      if (k) { e.preventDefault(); keys[k] = true; }
    });
    document.addEventListener('keyup', (e) => {
      const k = keyMap[e.key.toLowerCase()];
      if (k) keys[k] = false;
    });
  }

  function start(playerId) {
    localPlayerId = playerId;
    running = true;
    loop();
  }

  function stop() {
    running = false;
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  }

  function onGameState(state) {
    lastGameState = state;
  }

  function loop() {
    if (!running) return;
    animFrame = requestAnimationFrame(loop);

    Network.sendInput({ ...keys });

    if (!lastGameState || !lastGameState.grid) return;

    const player = lastGameState.tanks.find((t) => t.id === localPlayerId);
    if (!player) return;

    Renderer.render(player, lastGameState.tanks, lastGameState.projectiles, lastGameState.grid);
    Renderer.renderMinimap(player, lastGameState.tanks, lastGameState.grid);
    renderHud(player, lastGameState.scores);
  }

  function renderHud(player, scores) {
    const W = hudCanvas.width;
    const H = hudCanvas.height;

    hudCtx.fillStyle = '#000';
    hudCtx.fillRect(0, 0, W, H);

    hudCtx.fillStyle = '#00ff00';
    hudCtx.font = '12px monospace';

    // Health label
    hudCtx.textAlign = 'left';
    hudCtx.fillText('HP', 6, H / 2 + 4);

    // Health bar
    const hpFrac = Math.max(0, player.hp / 100);
    const barW = 80;
    const barX = 26;
    const barY = Math.floor(H / 2) - 6;
    hudCtx.strokeStyle = 'rgba(0,255,0,0.4)';
    hudCtx.strokeRect(barX, barY, barW, 12);
    hudCtx.fillStyle = '#00ff00';
    hudCtx.fillRect(barX + 1, barY + 1, Math.floor((barW - 2) * hpFrac), 10);

    // Score
    const myScore = (scores && scores[localPlayerId]) || 0;
    hudCtx.fillStyle = '#00ff00';
    hudCtx.textAlign = 'center';
    hudCtx.fillText('SCORE: ' + myScore, W / 2, H / 2 + 4);

    // Ammo
    hudCtx.textAlign = 'right';
    hudCtx.fillText('AMMO: inf', W - 6, H / 2 + 4);
    hudCtx.textAlign = 'left';
  }

  return { init, start, stop, onGameState };
})();
