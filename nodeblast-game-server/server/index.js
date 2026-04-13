const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 7777;
const TICK_RATE_MS = 50;
const MAX_PLAYERS_PER_ROOM = 8;
const MOVE_SPEED_CAP = 0.5;
const MAP_BOUNDS = 38;

const rooms = new Map();

function createRoom(roomId) {
  const room = {
    id: roomId,
    players: new Map(),
    tickTimer: null,
  };
  room.tickTimer = setInterval(() => tickRoom(room), TICK_RATE_MS);
  rooms.set(roomId, room);
  console.log(`[room] created: ${roomId}`);
  return room;
}

function destroyRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  clearInterval(room.tickTimer);
  rooms.delete(roomId);
  console.log(`[room] destroyed: ${roomId}`);
}

function tickRoom(room) {
  if (room.players.size === 0) return;
  const snapshot = [];
  room.players.forEach((p) => {
    snapshot.push({
      id: p.id,
      x: p.x, y: p.y, z: p.z,
      rotY: p.rotY, pitch: p.pitch,
      username: p.username,
      hex: p.hex,
    });
  });
  const msg = JSON.stringify({ type: 'snapshot', players: snapshot });
  room.players.forEach((p) => {
    if (p.ws.readyState === 1) p.ws.send(msg);
  });
}

function validateMove(player, newX, newY, newZ) {
  const dx = newX - player.x;
  const dz = newZ - player.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > MOVE_SPEED_CAP) {
    const scale = MOVE_SPEED_CAP / dist;
    newX = player.x + dx * scale;
    newZ = player.z + dz * scale;
  }
  newX = Math.max(-MAP_BOUNDS, Math.min(MAP_BOUNDS, newX));
  newZ = Math.max(-MAP_BOUNDS, Math.min(MAP_BOUNDS, newZ));
  newY = Math.max(0, Math.min(20, newY));
  return { x: newX, y: newY, z: newZ };
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[server] nodeblast-game-server listening on :${PORT}`);

wss.on('connection', (ws) => {
  const socketId = uuidv4();
  let playerRoom = null;
  let playerId = socketId;

  console.log(`[ws] connect: ${socketId}`);
  ws.send(JSON.stringify({ type: 'welcome', id: socketId }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'join': {
        const roomId = msg.roomId || 'default';
        let room = rooms.get(roomId);
        if (!room) room = createRoom(roomId);
        if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
          ws.send(JSON.stringify({ type: 'error', code: 'room_full' }));
          return;
        }
        playerRoom = room;
        playerId = msg.playerId || socketId;
        room.players.set(socketId, {
          id: playerId,
          ws,
          x: 0, y: 1.8, z: 0,
          rotY: 0, pitch: 0,
          username: msg.username || 'player',
          hex: msg.hex || '5aaa72',
          lastSeen: Date.now(),
        });
        ws.send(JSON.stringify({
          type: 'joined',
          roomId,
          playerId,
          playerCount: room.players.size,
        }));
        console.log(`[room:${roomId}] player joined: ${playerId} (${room.players.size} total)`);
        break;
      }
      case 'move': {
        if (!playerRoom) return;
        const player = playerRoom.players.get(socketId);
        if (!player) return;
        const validated = validateMove(player, msg.x, msg.y, msg.z);
        player.x = validated.x;
        player.y = validated.y;
        player.z = validated.z;
        player.rotY = msg.rotY || 0;
        player.pitch = msg.pitch || 0;
        player.lastSeen = Date.now();
        break;
      }
      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log(`[ws] disconnect: ${socketId}`);
    if (playerRoom) {
      playerRoom.players.delete(socketId);
      if (playerRoom.players.size === 0) destroyRoom(playerRoom.id);
    }
  });

  ws.on('error', (err) => {
    console.warn(`[ws] error ${socketId}:`, err.message);
  });
});

const http = require('http');
const healthServer = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('ok');
});
healthServer.listen(process.env.PORT_HTTP || 8080);
