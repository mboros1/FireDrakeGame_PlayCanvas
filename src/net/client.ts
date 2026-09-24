/**
 * One player's end of a multiplayer room, whoever hosts it.
 *
 * Sends this player's input, buffers the room's snapshots, and answers two
 * questions for the frame loop:
 *
 * - **Where is everyone else?** Remote drakes and dwarves are drawn
 *   {@link INTERPOLATION_DELAY_MS} in the past, between the two snapshots that
 *   bracket that moment, so they glide instead of stepping at 15 Hz.
 * - **Where should I be?** The local drake is predicted locally for
 *   responsiveness. Each snapshot says which input the host had applied
 *   (`ack`); comparing the host's position with where this client predicted
 *   itself *when it sent that input* gives the prediction error without the
 *   latency baked in, and the caller eases it away.
 *
 * The {@link Lobby} underneath finds or becomes the host and carries the
 * messages; this class neither knows nor cares which. View-free: no
 * PlayCanvas here.
 */

import type { LevelFile } from '../sim/level';
import {
  CLOSE_FULL,
  CLOSE_OUTDATED,
  encodeInput,
  PROTOCOL_VERSION,
  type ClientMessage,
  type DrakeRow,
  type DwarfRow,
  type PlayerInfo,
  type ServerMessage,
  type Snapshot
} from './protocol';
import { Lobby } from './lobby';
import type { MeshFactory } from './mesh';
import type { Input } from '../sim/types';

/** How far behind the newest snapshot remote entities are drawn. */
export const INTERPOLATION_DELAY_MS = 110;
const HISTORY = 128;

/**
 * `connecting` covers finding the room and its host. `reconnecting` is
 * transient: the host changed or the network blinked, and the session finds
 * its place on its own. `closed`, `full` and `outdated` are final until the
 * player acts.
 */
export type NetStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'full' | 'outdated';

type Timed = { at: number; snapshot: Snapshot };

export type RemoteDrake = { player: number; x: number; z: number; yaw: number; speed: number; breathing: boolean };
export type RemoteDwarf = { id: number; x: number; y: number; z: number; yaw: number; burn: number; airborne: boolean; stunned: boolean; spin: number; launches: number };

export type SessionOptions = {
  mesh: MeshFactory;
  /** How long to listen for a host before hosting: long enough for a real WebRTC handshake. */
  seekMs: number;
  /** The chapter to play, if this player ends up opening the room. */
  chapter?: LevelFile;
};

export class NetSession {
  status: NetStatus = 'connecting';
  player = -1;
  room = '';
  /** The level the room is playing, from its host. */
  level = '';
  /** The room's chapter, when it plays a bound one rather than a built-in. */
  chapter: LevelFile | null = null;
  roster: PlayerInfo[] = [];
  latencyMs = 0;
  readonly lobby: Lobby;

  onWelcome: () => void = () => {};
  onSnapshot: (snapshot: Snapshot) => void = () => {};
  onRestart: () => void = () => {};
  onRoster: (roster: PlayerInfo[]) => void = () => {};
  onStatus: (status: NetStatus) => void = () => {};

  private closing = false;
  private readonly buffer: Timed[] = [];
  private seq = 0;
  private reconciledTick = -1;
  /** Where the local drake was predicted to be when each input went out. */
  private readonly history = new Map<number, { x: number; z: number; yaw: number }>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(room: string, private readonly name: string, options: SessionOptions) {
    this.room = room;
    this.lobby = new Lobby(options.mesh, room, options.chapter, {
      connected: () => {
        this.setStatus('open');
        this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name });
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.send({ t: 'ping', at: performance.now() }), 2000);
      },
      message: message => this.receive(message),
      lost: () => {
        if (!this.closing) this.setStatus('reconnecting');
      },
      shut: code => {
        if (code === CLOSE_FULL) return this.setStatus('full');
        if (code === CLOSE_OUTDATED) return this.setStatus('outdated');
        // Idle, or anything else: say hello again.
        this.setStatus('reconnecting');
        setTimeout(() => {
          if (!this.closing) this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name });
        }, 500);
      }
    }, { seekMs: options.seekMs });
    void this.lobby.start().catch(() => this.setStatus('closed'));
  }

  /** True when this player's browser is running the room for everyone. */
  get hosting() {
    return this.lobby.hosting;
  }

  close() {
    this.closing = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.lobby.leave();
    this.setStatus('closed');
  }

  /** Debug: drop off the mesh as a flaky network would, without meaning to leave. */
  simulateDrop() {
    void this.lobby.simulateDrop();
  }

  requestRestart() {
    this.send({ t: 'restart' });
  }

  /**
   * One fixed prediction step happened locally: send the input it used and
   * remember where it left the drake, keyed by sequence number. The host
   * applies inputs one per tick in the same order, so when it acknowledges
   * `seq`, its drake and `history[seq]` should agree.
   */
  step(input: Input, after: { x: number; z: number; yaw: number }) {
    if (this.status !== 'open') return;
    const seq = ++this.seq;
    this.history.set(seq, { ...after });
    this.history.delete(seq - HISTORY);
    this.send(encodeInput(seq, input));
  }

  /**
   * The local drake's prediction error at the host's newest acknowledged
   * input, or null if there is nothing new to correct. Each snapshot is
   * reported once. The caller moves the drake (and this history) by the
   * error, so later comparisons measure only new drift.
   */
  reconciliation(): { dx: number; dz: number; dyaw: number } | null {
    const latest = this.buffer.at(-1)?.snapshot;
    if (!latest || latest.tick === this.reconciledTick) return null;
    this.reconciledTick = latest.tick;
    const row = latest.drakes.find(d => d[0] === this.player);
    if (!row) return null;
    const then = this.history.get(row[6]);
    if (!then) return null;
    const correction = { dx: row[1] - then.x, dz: row[2] - then.z, dyaw: shortestAngle(then.yaw, row[3]) };
    for (const [seq, entry] of this.history) {
      if (seq < row[6]) continue;
      entry.x += correction.dx;
      entry.z += correction.dz;
      entry.yaw += correction.dyaw;
    }
    return correction;
  }

  /** The host's view of the local drake, for large corrections. */
  localRow(): DrakeRow | null {
    const latest = this.buffer.at(-1)?.snapshot;
    return latest?.drakes.find(d => d[0] === this.player) ?? null;
  }

  /** Remote drakes and dwarves as they were {@link INTERPOLATION_DELAY_MS} ago. */
  sample(now: number): { drakes: RemoteDrake[]; dwarves: RemoteDwarf[] } | null {
    if (this.buffer.length === 0) return null;
    const renderAt = now - INTERPOLATION_DELAY_MS;
    let a = this.buffer[0];
    let b = this.buffer[0];
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].at <= renderAt) {
        a = this.buffer[i];
        b = this.buffer[Math.min(i + 1, this.buffer.length - 1)];
        break;
      }
    }
    const span = b.at - a.at;
    const t = span > 0 ? Math.min(1, Math.max(0, (renderAt - a.at) / span)) : 1;

    const drakes: RemoteDrake[] = [];
    for (const rowB of b.snapshot.drakes) {
      if (rowB[0] === this.player) continue;
      const rowA = a.snapshot.drakes.find(d => d[0] === rowB[0]) ?? rowB;
      drakes.push({
        player: rowB[0],
        x: lerp(rowA[1], rowB[1], t),
        z: lerp(rowA[2], rowB[2], t),
        yaw: rowA[3] + shortestAngle(rowA[3], rowB[3]) * t,
        speed: lerp(rowA[4], rowB[4], t),
        breathing: (rowB[5] & 2) !== 0
      });
    }

    const dwarves: RemoteDwarf[] = [];
    const earlier = new Map<number, DwarfRow>(a.snapshot.dwarves.map(d => [d[0], d]));
    for (const rowB of b.snapshot.dwarves) {
      const rowA = earlier.get(rowB[0]) ?? rowB;
      dwarves.push({
        id: rowB[0],
        x: lerp(rowA[1], rowB[1], t),
        y: lerp(rowA[2], rowB[2], t),
        z: lerp(rowA[3], rowB[3], t),
        yaw: rowA[4] + shortestAngle(rowA[4], rowB[4]) * t,
        burn: rowB[5],
        airborne: (rowB[6] & 1) !== 0,
        stunned: (rowB[6] & 2) !== 0,
        spin: lerp(rowA[7], rowB[7], t),
        launches: rowB[8]
      });
    }
    return { drakes, dwarves };
  }

  private receive(message: ServerMessage) {
    switch (message.t) {
      case 'welcome':
        // A fresh start: on a reconnect, old snapshots and inputs belong to
        // a previous seat and must not be reconciled against.
        this.buffer.length = 0;
        this.history.clear();
        this.reconciledTick = -1;
        this.player = message.player;
        this.level = message.level;
        this.chapter = message.chapter ?? null;
        this.onWelcome();
        break;
      case 'roster':
        this.roster = message.players;
        this.onRoster(message.players);
        break;
      case 'full':
        this.setStatus('full');
        break;
      case 'restart':
        this.buffer.length = 0;
        this.history.clear();
        this.level = message.level;
        this.chapter = message.chapter ?? null;
        this.onRestart();
        break;
      case 'pong':
        this.latencyMs = this.latencyMs ? this.latencyMs * .7 + (performance.now() - message.at) * .3 : performance.now() - message.at;
        break;
      case 'snap':
        this.buffer.push({ at: performance.now(), snapshot: message });
        // A second of history is plenty for interpolation.
        while (this.buffer.length > 20) this.buffer.shift();
        this.onSnapshot(message);
        break;
      default:
        break;
    }
  }

  private send(message: ClientMessage) {
    this.lobby.send(message);
  }

  private setStatus(status: NetStatus) {
    this.status = status;
    this.onStatus(status);
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const shortestAngle = (from: number, to: number) => ((to - from + 540) % 360) - 180;

/** A room code people can read aloud: "cheese-417". */
export const randomRoomCode = () => {
  const words = ['cheese', 'kindling', 'ember', 'hoard', 'maypole', 'thatch', 'cinder', 'hayrick', 'scorch', 'wyvern', 'goblet', 'bonfire'];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(100 + Math.random() * 900)}`;
};
