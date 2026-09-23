/**
 * Fire Drake room server.
 *
 *   npm run server:dev          # build and run locally on :8080
 *   fly deploy                  # ship it (see fly.toml)
 *
 * One HTTP port. `GET /` is a health check; `/ws?room=<name>&name=<player>`
 * upgrades to the game's WebSocket. Rooms are created on first join and
 * discarded when the last player leaves, so an idle server holds nothing —
 * which is also what lets Fly stop the machine between sessions.
 */

import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { cleanRoom, type ClientMessage } from '../src/net/protocol';
import { Room } from './room';

const PORT = Number(process.env.PORT ?? 8080);
const rooms = new Map<string, Room>();
const startedAt = Date.now();

const http = createServer((request, response) => {
  if (request.url === '/' || request.url?.startsWith('/health')) {
    const players = [...rooms.values()].reduce((sum, room) => sum + room.size, 0);
    response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    response.end(JSON.stringify({ ok: true, rooms: rooms.size, players, uptime: Math.round((Date.now() - startedAt) / 1000) }));
    return;
  }
  response.writeHead(404).end();
});

const sockets = new WebSocketServer({ server: http, path: '/ws', maxPayload: 4096 });

sockets.on('connection', (socket: WebSocket, request) => {
  const url = new URL(request.url ?? '/ws', 'http://localhost');
  const roomName = cleanRoom(url.searchParams.get('room'));
  const playerName = url.searchParams.get('name') ?? '';

  let room = rooms.get(roomName);
  if (!room) {
    room = new Room(roomName, emptied => {
      rooms.delete(emptied.name);
      console.log(`room ${emptied.name} closed`);
    });
    rooms.set(roomName, room);
    console.log(`room ${roomName} opened`);
  }
  if (!room.join(socket, playerName)) {
    socket.close(4001, 'room full');
    return;
  }
  console.log(`room ${roomName}: ${room.size} player(s)`);

  const joined = room;
  socket.on('message', data => {
    let message: ClientMessage;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (message && typeof message === 'object' && typeof message.t === 'string') joined.receive(socket, message);
  });
  socket.on('close', () => joined.leave(socket));
  socket.on('error', () => joined.leave(socket));
});

http.listen(PORT, '0.0.0.0', () => console.log(`fire drake server listening on :${PORT}`));

// Fly sends SIGINT/SIGTERM on stop; close sockets so clients see a clean drop.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    for (const client of sockets.clients) client.close(1001, 'server stopping');
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
