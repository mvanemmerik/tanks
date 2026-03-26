const http = require('http');
const { io: ioClient } = require('socket.io-client');

// server.js exports {app, server, io}; use a test port to avoid conflicts
process.env.PORT = '3099';
const { server } = require('../server');

beforeAll((done) => { server.listen(3099, done); });
afterAll((done) => { server.close(done); });

const URL = 'http://localhost:3099';

function connect() {
  return new Promise((resolve) => {
    const s = ioClient(URL);
    s.on('connect', () => resolve(s));
  });
}

test('server accepts connections', (done) => {
  const s = ioClient(URL);
  s.on('connect', () => { expect(s.connected).toBe(true); s.disconnect(); done(); });
});

test('join with valid name receives lobby-state', (done) => {
  connect().then((s) => {
    s.on('lobby-state', (data) => {
      expect(data.players.some((p) => p.name === 'Alice_' + process.pid)).toBe(true);
      expect(data.hostId).toBeDefined();
      s.disconnect();
      done();
    });
    s.emit('join', { name: 'Alice_' + process.pid });
  });
});

test('join with duplicate name receives name-error', (done) => {
  const name = 'Dupe_' + Date.now();
  connect().then((s1) => {
    s1.on('lobby-state', () => {
      connect().then((s2) => {
        s2.on('name-error', (data) => {
          expect(data.message).toMatch(/taken/i);
          s1.disconnect(); s2.disconnect();
          done();
        });
        s2.emit('join', { name });
      });
    });
    s1.emit('join', { name });
  });
});

test('first connected player is host', (done) => {
  const name = 'Host_' + Date.now();
  connect().then((s) => {
    s.on('lobby-state', (data) => {
      expect(data.hostId).toBe(s.id);
      s.disconnect();
      done();
    });
    s.emit('join', { name });
  });
});
