// Thin Socket.io client wrapper. Exposes a global `Network` object.
// Scripts must load socket.io client before this file.

const Network = (() => {
  let socket = null;
  const handlers = {};

  function on(event, fn) { handlers[event] = fn; }

  function connect() {
    socket = io(); // socket.io.js loaded via CDN script tag in index.html
    ['lobby-state', 'game-state', 'game-over', 'game-start',
     'map-data', 'waiting', 'name-error'].forEach((evt) => {
      socket.on(evt, (data) => { if (handlers[evt]) handlers[evt](data); });
    });
  }

  function join(name) { if (socket) socket.emit('join', { name }); }
  function startGame(map) { if (socket) socket.emit('start-game', { map }); }
  function sendInput(keys) { if (socket) socket.emit('input', keys); }
  function getId() { return socket ? socket.id : null; }

  return { connect, join, startGame, sendInput, on, getId };
})();
