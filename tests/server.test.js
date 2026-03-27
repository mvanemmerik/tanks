const http = require('http');
const { io: ioClient } = require('socket.io-client');

// server.js exports {app, server, io}; use a test port to avoid conflicts
process.env.PORT = '3099';
const { server, _resetForTesting } = require('../server');

beforeAll((done) => { server.listen(3099, done); });
afterAll((done) => { server.close(done); });

// Reset server state before each test to prevent cross-test contamination
beforeEach(() => _resetForTesting());

const URL = 'http://localhost:3099';

function connect() {
  return new Promise((resolve) => {
    const s = ioClient(URL);
    s.on('connect', () => resolve(s));
  });
}

// Test helper: creates a room and resolves with { socket, roomCode }
function createRoom(name, isPublic = true) {
  return connect().then((s) => new Promise((resolve) => {
    s.on('room-created', ({ roomCode }) => resolve({ socket: s, roomCode }));
    s.emit('create-room', { name, isPublic });
  }));
}

test('server accepts connections', (done) => {
  const s = ioClient(URL);
  s.on('connect', () => { expect(s.connected).toBe(true); s.disconnect(); done(); });
});

test('create-room emits room-created with a 6-char alphanumeric code', (done) => {
  createRoom('Alice').then(({ socket, roomCode }) => {
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);
    socket.disconnect();
    done();
  });
});

test('create-room emits lobby-state with creator as host', (done) => {
  connect().then((s) => {
    s.on('room-created', () => {});
    s.on('lobby-state', ({ players, hostId }) => {
      expect(players.some((p) => p.name === 'Bob')).toBe(true);
      expect(hostId).toBe(s.id);
      s.disconnect();
      done();
    });
    s.emit('create-room', { name: 'Bob', isPublic: true });
  });
});

test('join-room adds player and broadcasts lobby-state to whole room', (done) => {
  createRoom('Host').then(({ socket: host, roomCode }) => {
    connect().then((joiner) => {
      joiner.on('lobby-state', ({ players }) => {
        expect(players.length).toBe(2);
        host.disconnect(); joiner.disconnect();
        done();
      });
      joiner.emit('join-room', { roomCode, name: 'Joiner' });
    });
  });
});

test('join-room with duplicate name emits room-error', (done) => {
  createRoom('Alice').then(({ socket: s1, roomCode }) => {
    connect().then((s2) => {
      s2.on('room-error', ({ message }) => {
        expect(message).toMatch(/taken/i);
        s1.disconnect(); s2.disconnect();
        done();
      });
      s2.emit('join-room', { roomCode, name: 'Alice' });
    });
  });
});

test('join-room with unknown code emits room-error', (done) => {
  connect().then((s) => {
    s.on('room-error', ({ message }) => {
      expect(message).toMatch(/not found/i);
      s.disconnect();
      done();
    });
    s.emit('join-room', { roomCode: 'XXXXXX', name: 'Alice' });
  });
});

test('game-list includes public lobby rooms only', (done) => {
  connect().then((observer) => {
    observer.on('game-list', (list) => {
      expect(Array.isArray(list)).toBe(true);
      list.forEach((r) => {
        expect(r.roomCode).toBeDefined();
        expect(typeof r.playerCount).toBe('number');
      });
      observer.disconnect();
      done();
    });
    // Creating a public room triggers broadcastGameList
    createRoom('Host', true).then(() => {});
  });
});

test('game-list excludes private rooms', (done) => {
  connect().then((observer) => {
    let received = false;
    observer.on('game-list', (list) => {
      if (!received) {
        received = true;
        // Private room must not appear
        expect(list.length).toBe(0);
        observer.disconnect();
        done();
      }
    });
    createRoom('Host', false).then(() => {});
  });
});

test('room is deleted when last player disconnects', (done) => {
  createRoom('Solo').then(({ socket, roomCode }) => {
    connect().then((observer) => {
      let created = false;
      observer.on('game-list', (list) => {
        if (!created) { created = true; return; } // skip first broadcast (room exists)
        const stillThere = list.some((r) => r.roomCode === roomCode);
        if (!stillThere) { observer.disconnect(); done(); }
      });
      socket.disconnect();
    });
  });
});

test('join-room while game is playing emits room-error', (done) => {
  createRoom('Host').then(({ socket: host, roomCode }) => {
    host.emit('start-game', { map: 'A' });
    setTimeout(() => {
      connect().then((late) => {
        late.on('room-error', ({ message }) => {
          expect(message).toMatch(/in progress/i);
          host.disconnect(); late.disconnect();
          done();
        });
        late.emit('join-room', { roomCode, name: 'Latecomer' });
      });
    }, 100);
  });
});
