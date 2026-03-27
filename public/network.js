// Thin Socket.io client wrapper. Exposes a global `Network` object.
// Scripts must load socket.io client before this file.

const Network = (() => {
  let socket = null;
  const handlers = {};

  function on(event, fn) { handlers[event] = fn; }

  function connect() {
    socket = io();
    [
      'lobby-state', 'game-state', 'game-over', 'game-start',
      'map-data', 'name-error',
      'room-created', 'room-error', 'game-list',
    ].forEach((evt) => {
      socket.on(evt, (data) => { if (handlers[evt]) handlers[evt](data); });
    });
  }

  function createRoom(name, isPublic) {
    if (socket) socket.emit('create-room', { name, isPublic });
  }
  function joinRoom(roomCode, name) {
    if (socket) socket.emit('join-room', { roomCode, name });
  }
  function startGame(map) { if (socket) socket.emit('start-game', { map }); }
  function sendInput(keys) { if (socket) socket.emit('input', keys); }
  function getId() { return socket ? socket.id : null; }

  return { connect, createRoom, joinRoom, startGame, sendInput, on, getId };
})();
