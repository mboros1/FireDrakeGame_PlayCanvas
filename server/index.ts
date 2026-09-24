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
import { CLOSE_BUSY, CLOSE_FULL, CLOSE_NO_CHAPTER, CLOSE_OUTDATED, cleanRoom, PROTOCOL_VERSION, type ClientMessage } from '../src/net/protocol';
import { Room } from './room';
import { CHAPTER_CODE, SqliteChapterStore, type ChapterStore } from './chapters';
import { LevelError, toLevelFile, validateLevel } from '../src/sim/level';

const PORT = Number(process.env.PORT ?? 8080);
/** On Fly, the volume is mounted at /data; locally, a folder next to the repo. */
const CHAPTERS_DB = process.env.CHAPTERS_DB ?? (process.env.FLY_APP_NAME ? '/data/chapters.db' : '.data/chapters.db');
/** Set with `fly secrets set ADMIN_TOKEN=...` to enable the backup export. */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const chapters: ChapterStore = new SqliteChapterStore(CHAPTERS_DB);
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
/** Binding: chapters are small, and each IP may bind a handful an hour. */
const CHAPTER_MAX_BYTES = 128 * 1024;
const BINDS_PER_HOUR = Number(process.env.BINDS_PER_HOUR ?? 12);
const bindsByIp = new Map<string, { count: number; since: number }>();

const json = (response: import('node:http').ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  response.end(JSON.stringify(body));
};

const readBody = (request: import('node:http').IncomingMessage, limit: number) => new Promise<string | null>(resolve => {
  let body = '';
  let size = 0;
  request.setEncoding('utf8');
  request.on('data', chunk => {
    size += chunk.length;
    if (size > limit) {
      resolve(null);
      request.destroy();
      return;
    }
    body += chunk;
  });
  request.on('end', () => resolve(body));
  request.on('error', () => resolve(null));
});

/** `POST /chapters`: validate a level and bind it; answers `{ code }`. */
const bindChapter = async (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
  const ip = clientIp(request);
  const now = Date.now();
  const bucket = bindsByIp.get(ip);
  if (bucket && now - bucket.since < 3_600_000 && bucket.count >= BINDS_PER_HOUR) {
    return json(response, 429, { error: 'Too many chapters bound from here this hour. The binder needs a rest.' });
  }
  const body = await readBody(request, CHAPTER_MAX_BYTES);
  if (body === null) return json(response, 413, { error: 'That chapter is too long to bind.' });
  let level;
  try {
    level = validateLevel(JSON.parse(body));
  } catch (error) {
    const problems = error instanceof LevelError ? error.problems : ['not a chapter file'];
    return json(response, 400, { error: 'That is not a chapter the binder can accept.', problems: problems.slice(0, 20) });
  }
  if (!bucket || now - bucket.since >= 3_600_000) bindsByIp.set(ip, { count: 1, since: now });
  else bucket.count++;
  const code = chapters.bind(level, ip);
  console.log(`chapter ${code} bound: "${level.title}", ${level.props.length} props`);
  json(response, 201, { code });
};

/** `GET /chapters/:code`: the bound chapter, as a level file. */
const readChapter = (code: string, response: import('node:http').ServerResponse) => {
  const chapter = CHAPTER_CODE.test(code) ? chapters.get(code) : null;
  if (!chapter) return json(response, 404, { error: 'No chapter by that code.' });
  chapters.read(code);
  json(response, 200, { code: chapter.code, title: chapter.title, heading: chapter.heading, mood: chapter.mood, createdAt: chapter.createdAt, level: toLevelFile(chapter.level) });
};

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
  const path = (request.url ?? '/').split('?')[0];
  if (request.method === 'POST' && path === '/report') return receiveReport(request, response);
  if (request.method === 'POST' && path === '/chapters') return void bindChapter(request, response);
  if (request.method === 'GET' && path.startsWith('/chapters/')) return readChapter(decodeURIComponent(path.slice('/chapters/'.length)), response);
  if (request.method === 'GET' && path === '/admin/chapters.jsonl') {
    // The backup: every chapter, one per line. Disabled unless ADMIN_TOKEN is set.
    if (!ADMIN_TOKEN || request.headers.authorization !== `Bearer ${ADMIN_TOKEN}`) return json(response, 403, { error: 'forbidden' });
    response.writeHead(200, { 'content-type': 'application/x-ndjson' });
    response.end(chapters.exportAll());
    return;
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' }).end();
    return;
  }
  if (request.url === '/' || request.url?.startsWith('/health')) {
    const players = [...rooms.values()].reduce((sum, room) => sum + room.size, 0);
    response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    response.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, rooms: rooms.size, players, chapters: chapters.count(), uptime: Math.round((Date.now() - startedAt) / 1000) }));
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

  // The first to open a room chooses its chapter; later joiners join whatever it plays.
  const chapterCode = url.searchParams.get('chapter') ?? '';
  let room = rooms.get(roomName);
  if (!room) {
    const chapter = chapterCode ? chapters.get(chapterCode) : null;
    if (chapterCode && !chapter) {
      socket.close(CLOSE_NO_CHAPTER, 'no such chapter');
      return;
    }
    room = new Room(roomName, emptied => {
      rooms.delete(emptied.name);
      console.log(`room ${emptied.name} closed`);
    }, chapter?.level);
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
