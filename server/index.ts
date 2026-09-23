/**
 * Fire Drake room server.
 *
 *   npm run server:dev          # build and run locally on :8787
 *   fly deploy                  # ship it (see fly.toml)
 *
 * One HTTP port. `GET /` is a health check; `/ws?room=<name>&name=<player>`
 * upgrades to the game's WebSocket. Rooms are created on first join and
 * discarded when the last player leaves, so an idle server holds nothing —
 * which is also what lets Fly stop the machine between sessions.
 */

import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { CLOSE_BUSY, CLOSE_FULL, CLOSE_OUTDATED, cleanRoom, PROTOCOL_VERSION, type ClientMessage } from '../src/net/protocol';
import { Room } from './room';

const PORT = Number(process.env.PORT ?? 8080);
const rooms = new Map<string, Room>();
const startedAt = Date.now();

/** Protection for one small machine: plenty for friends, not for a flood. */
const MAX_ROOMS = 200;
const MAX_CONNECTIONS_PER_IP = 8;
/** Ping every socket this often; one that has not answered since is dead. */
const HEARTBEAT_MS = 15_000;
const connectionsByIp = new Map<string, number>();
const alive = new WeakMap<WebSocket, boolean>();

/** Client reports: small, few, and only ever written to the log. */
const REPORT_MAX_BYTES = 8192;
const REPORTS_PER_MINUTE = 30;
const reportsByIp = new Map<string, { count: number; since: number }>();

const clientIp = (request: import('node:http').IncomingMessage) =>
  String(request.headers['fly-client-ip'] ?? request.socket.remoteAddress ?? 'unknown');

/**
 * `POST /report`: an error or a session summary from a player's browser,
 * logged as one JSON line (`fly logs | grep report`). Sent with
 * `navigator.sendBeacon` as text/plain, which needs no CORS preflight from
 * the itch.io frame. Nothing is stored; the log is the record.
 */
const receiveReport = (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
  const ip = clientIp(request);
  const now = Date.now();
  const bucket = reportsByIp.get(ip);
  if (bucket && now - bucket.since < 60_000 && bucket.count >= REPORTS_PER_MINUTE) {
    response.writeHead(429, { 'access-control-allow-origin': '*' }).end();
    return;
  }
  if (!bucket || now - bucket.since >= 60_000) reportsByIp.set(ip, { count: 1, since: now });
  else bucket.count++;

  let body = '';
  let tooBig = false;
  request.setEncoding('utf8');
  request.on('data', chunk => {
    body += chunk;
    if (body.length > REPORT_MAX_BYTES) {
      tooBig = true;
      request.destroy();
    }
  });
  request.on('end', () => {
    if (tooBig) return;
    let report: unknown;
    try {
      report = JSON.parse(body);
    } catch {
      response.writeHead(400, { 'access-control-allow-origin': '*' }).end();
      return;
    }
    if (report && typeof report === 'object') {
      // Keep the log line bounded and flat; never trust client field sizes.
      const clipped = Object.fromEntries(Object.entries(report as Record<string, unknown>).slice(0, 24)
        .map(([k, v]) => [k.slice(0, 32), typeof v === 'string' ? v.slice(0, 600) : v]));
      console.log(`report ${JSON.stringify({ at: new Date().toISOString(), ...clipped })}`);
    }
    response.writeHead(204, { 'access-control-allow-origin': '*' }).end();
  });
};

const http = createServer((request, response) => {
  if (request.method === 'POST' && request.url?.startsWith('/report')) return receiveReport(request, response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' }).end();
    return;
  }
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

  // A page from before a protocol change must refresh, not misread snapshots.
  if (Number(url.searchParams.get('v')) !== PROTOCOL_VERSION) {
    socket.close(CLOSE_OUTDATED, 'outdated client');
    return;
  }
  // Fly's proxy puts the real client address in Fly-Client-IP.
  const ip = clientIp(request);
  const fromIp = connectionsByIp.get(ip) ?? 0;
  if (fromIp >= MAX_CONNECTIONS_PER_IP || (!rooms.has(roomName) && rooms.size >= MAX_ROOMS)) {
    socket.close(CLOSE_BUSY, 'server busy');
    return;
  }
  connectionsByIp.set(ip, fromIp + 1);
  socket.once('close', () => {
    const left = (connectionsByIp.get(ip) ?? 1) - 1;
    if (left <= 0) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, left);
  });
  alive.set(socket, true);
  socket.on('pong', () => alive.set(socket, true));

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
    socket.close(CLOSE_FULL, 'room full');
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

// Phones drop off networks without closing sockets; heartbeats find them.
setInterval(() => {
  for (const client of sockets.clients) {
    if (alive.get(client) === false) {
      client.terminate();
      continue;
    }
    alive.set(client, false);
    client.ping();
  }
}, HEARTBEAT_MS).unref();

http.listen(PORT, '0.0.0.0', () => console.log(`fire drake server listening on :${PORT} (protocol ${PROTOCOL_VERSION})`));

// Fly sends SIGINT/SIGTERM on stop; close sockets so clients see a clean drop.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    for (const client of sockets.clients) client.close(1001, 'server stopping');
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
