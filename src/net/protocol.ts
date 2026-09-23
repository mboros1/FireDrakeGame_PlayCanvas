/**
 * Wire protocol between the browser and the room server. This module must
 * never import `playcanvas`: the server bundles it.
 *
 * JSON, deliberately. At this game's scale (a few drakes, a dozen dwarves,
 * a hundred-odd props) a snapshot is a couple of kilobytes at 15 Hz, and JSON
 * is debuggable in the browser's network panel. `docs/ARCHITECTURE.md` picks
 * CBOR for the long run; the message shapes here are what would carry over.
 *
 * Numbers are rounded before sending (centimetres, tenths of a degree) to keep
 * snapshots small; nothing downstream needs more precision.
 */

import type { RampageEvent } from '../sim/rampage';
import type { Input } from '../sim/types';

export const PROTOCOL_VERSION = 1;

/** Server simulation rate. Clients render faster and interpolate. */
export const SERVER_TICK_HZ = 30;
/** Snapshots per second. Every other tick. */
export const SNAPSHOT_HZ = 15;
export const MAX_PLAYERS = 4;

/** Player colours, by seat. The first is the drake's own red. */
export const PLAYER_COLOURS = [
  { name: 'Crimson', css: '#c7343c', tint: [1, 1, 1] },
  { name: 'Teal', css: '#2f9f97', tint: [.45, 1.15, 1.05] },
  { name: 'Gold', css: '#e2a93b', tint: [1.25, 1.05, .45] },
  { name: 'Violet', css: '#8a5cc7', tint: [.85, .6, 1.3] }
] as const;

// ── Client → server ─────────────────────────────────────────────────────────

export type ClientMessage =
  | { t: 'hello'; v: number; name: string }
  | { t: 'input'; seq: number; f: number; r: number; c: 0 | 1; b: 0 | 1; y: number }
  | { t: 'restart' }
  | { t: 'ping'; at: number };

export const encodeInput = (seq: number, input: Input): ClientMessage => ({
  t: 'input',
  seq,
  f: input.forward,
  r: input.right,
  c: input.charging ? 1 : 0,
  b: input.breathing ? 1 : 0,
  y: Math.round(input.cameraYaw * 10) / 10
});

export const decodeInput = (m: Extract<ClientMessage, { t: 'input' }>, into: Input): Input => {
  into.forward = clampUnit(m.f);
  into.right = clampUnit(m.r);
  into.charging = m.c === 1;
  into.breathing = m.b === 1;
  into.cameraYaw = Number.isFinite(m.y) ? m.y : 0;
  return into;
};

const clampUnit = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

// ── Server → client ─────────────────────────────────────────────────────────

/**
 * [player, x, z, yaw, speed, flags, ack] — flags: 1 breathed this tick,
 * 2 breathing held. `ack` is the last input sequence number the server had
 * applied for that player, which the owning client uses to reconcile.
 */
export type DrakeRow = [number, number, number, number, number, number, number];
/** [id, x, y, z, yaw, burn, bits, spin, launches] — bits: 1 airborne, 2 stunned. */
export type DwarfRow = [number, number, number, number, number, number, number, number, number];
/** [prop index, state, burnElapsed] — only props that are not intact. */
export type PropRow = [number, number, number];

export type Snapshot = {
  t: 'snap';
  tick: number;
  score: number;
  combo: number;
  best: number;
  /** Per-player share of the score: [player, points]. */
  points: [number, number][];
  drakes: DrakeRow[];
  dwarves: DwarfRow[];
  props: PropRow[];
  events: RampageEvent[];
};

export type PlayerInfo = { player: number; name: string; colour: number };

export type ServerMessage =
  | { t: 'welcome'; v: number; player: number; colour: number; room: string; seed: number; tickHz: number; level: string }
  | { t: 'roster'; players: PlayerInfo[] }
  | { t: 'full' }
  | { t: 'restart'; seed: number; level: string }
  | { t: 'pong'; at: number }
  | Snapshot;

export const cm = (v: number) => Math.round(v * 100) / 100;
export const deg = (v: number) => Math.round(v * 10) / 10;

/** Room names are short, lower-case and URL-safe. Anything else is cleaned. */
export const cleanRoom = (raw: string | null | undefined) =>
  (raw ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'kindling';
