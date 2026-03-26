const { generateWaypoints, tickBot } = require('../bot-ai');

const GRID_OPEN = [
  [1,1,1,1],
  [1,0,0,1],
  [1,0,0,1],
  [1,1,1,1],
];

describe('generateWaypoints', () => {
  test('generates waypoints only for open cells', () => {
    const wps = generateWaypoints(GRID_OPEN);
    expect(wps.length).toBe(4);
  });

  test('each waypoint has col and row pointing to an open cell', () => {
    const wps = generateWaypoints(GRID_OPEN);
    wps.forEach((wp) => {
      expect(wp.col).toBeDefined();
      expect(wp.row).toBeDefined();
      expect(GRID_OPEN[wp.row][wp.col]).toBe(0);
    });
  });
});

describe('tickBot', () => {
  const waypoints = generateWaypoints(GRID_OPEN);

  function makeTank(overrides = {}) {
    return {
      id: 'bot-1', x: 96, y: 96, angle: 0, hp: 100,
      isBot: true, lastShot: 0,
      inputKeys: { w: false, a: false, s: false, d: false, space: false },
      aiState: 'roam', currentWaypoint: null, noTargetTimer: 0,
      ...overrides,
    };
  }

  test('bot in roam state picks a waypoint if none set', () => {
    const bot = makeTank();
    tickBot(bot, [], waypoints, GRID_OPEN, Date.now());
    expect(bot.currentWaypoint).not.toBeNull();
  });

  test('bot transitions to engage when human is close and has LOS', () => {
    const bot = makeTank({ x: 96, y: 96 });
    const human = { id: 'h1', x: 128, y: 96, hp: 100, isBot: false };
    tickBot(bot, [human], waypoints, GRID_OPEN, Date.now());
    expect(bot.aiState).toBe('engage');
  });

  test('bot stays in roam when no humans are present', () => {
    const bot = makeTank();
    tickBot(bot, [], waypoints, GRID_OPEN, Date.now());
    expect(bot.aiState).toBe('roam');
  });

  test('bot does not shoot when cooldown has not expired', () => {
    const bot = makeTank({ x: 96, y: 96, lastShot: Date.now() + 9999 }); // future lastShot
    const human = { id: 'h1', x: 128, y: 96, hp: 100, isBot: false };
    tickBot(bot, [human], waypoints, GRID_OPEN, Date.now());
    expect(bot.inputKeys.space).toBe(false);
  });

  test('bot shoots when aligned with target and cooldown elapsed', () => {
    const bot = makeTank({ x: 96, y: 96, angle: 0, lastShot: 0 });
    // Human directly to the right (angle 0), within range
    const human = { id: 'h1', x: 128, y: 96, hp: 100, isBot: false };
    tickBot(bot, [human], waypoints, GRID_OPEN, Date.now());
    expect(bot.inputKeys.space).toBe(true);
  });

  test('bot returns to roam after no target for 2 seconds', () => {
    const bot = makeTank({ aiState: 'engage', lastTargetSeenAt: Date.now() - 2100 });
    tickBot(bot, [], waypoints, GRID_OPEN, Date.now());
    expect(bot.aiState).toBe('roam');
  });
});
