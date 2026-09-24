/**
 * One village, simulated authoritatively for up to four drakes, in the
 * browser of whichever player hosts the room (see `lobby.ts`).
 *
 * The room runs exactly the simulation the single-player client runs —
 * `Rampage` over a `World` — at a fixed 30 Hz, fed by each player's latest
 * input. Clients never send positions; they send button bits and a look
 * angle, and render what the room tells them. The host's own client is a
 * client like any other, over a loopback {@link Link}, so it gets no
 * advantage and the code has one path.
 *
 * View-free: no PlayCanvas, and no transport. A {@link Link} is anything
 * that can carry a string to one player.
 */

import { World } from '../sim/world';
import { Rng } from '../sim/random';
import { DrakeSim } from '../sim/drake';
import { Rampage, type RampageEvent } from '../sim/rampage';
import { spawnFor, toLevelFile, type LevelDefinition, type LevelFile } from '../sim/level';
import { getLevel } from '../sim/levels';
import { NO_INPUT, type Input, type Transform } from '../sim/types';
import { every } from './ticker';
import {
  CLOSE_IDLE,
  cm,
  decodeInput,
  deg,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  SERVER_TICK_HZ,
  SNAPSHOT_HZ,
  type ClientMessage,
  type DrakeRow,
  type DwarfRow,
  type PlayerInfo,
  type PropRow,
  type ServerMessage,
  type Snapshot
} from './protocol';

/** One player's connection to the room. */
export interface Link {
  readonly open: boolean;
  send(data: string): void;
  /** Tell the player why they are out, and stop sending to them. */
  close(code: number): void;
}

const TICK = 1 / SERVER_TICK_HZ;
const TICKS_PER_SNAPSHOT = Math.round(SERVER_TICK_HZ / SNAPSHOT_HZ);
/**
 * A player who sends nothing this long is dropped. Generous: a backgrounded
 * tab stops sending inputs, and the player may come back.
 */
const IDLE_TIMEOUT_MS = 45_000;
/** Most ticks to run in one timer callback when catching up after a stall. */
const MAX_CATCH_UP_TICKS = 4;
/** Inputs arriving faster than this per second are ignored, not queued. */
const MAX_INPUTS_PER_SECOND = 90;

type Player = {
  link: Link;
  seat: number;
  name: string;
  drake: DrakeSim;
  input: Input;
  lastSeen: number;
  inputBudget: number;
  /** Highest input sequence number applied, echoed so the client can reconcile. */
  ack: number;
  /** Inputs received but not yet applied, oldest first: one per tick. */
  queue: { seq: number; input: Input }[];
};

/**
 * Inputs are applied one per tick, in order, exactly as the client applied
 * them when predicting. If a client falls behind (a stall, a burst), the
 * backlog is trimmed so input latency cannot grow without bound.
 */
const MAX_QUEUED_INPUTS = 4;

export class Room {
  private world = new World();
  private rng: Rng;
  private layout: LevelDefinition = getLevel();
  private rampage: Rampage;
  private readonly players = new Map<Link, Player>();
  private stopTimer: (() => void) | null = null;
  private tick = 0;
  private pending: RampageEvent[] = [];
  private seed: number;
  private readonly at: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
  /** Wall-clock time owed to the simulation, so late timers do not slow the game. */
  private owed = 0;
  private lastTimer = 0;

  /** The chapter file, sent to every joiner, when this room plays a bound chapter. */
  private readonly chapter: LevelFile | undefined;

  constructor(readonly name: string, private readonly onEmpty: (room: Room) => void, chapter?: LevelDefinition) {
    this.seed = hashRoom(name);
    this.rng = new Rng(this.seed);
    if (chapter) {
      this.layout = chapter;
      this.chapter = toLevelFile(chapter);
    }
    this.rampage = new Rampage(this.world, this.rng, null, this.layout, true);
  }

  /** The level this room plays, for joiners asking for a different one. */
  get levelId() {
    return this.layout.id;
  }

  get size() {
    return this.players.size;
  }

  join(link: Link, requestedName: string): boolean {
    if (this.players.size >= MAX_PLAYERS) {
      send(link, { t: 'full' });
      return false;
    }
    const taken = new Set([...this.players.values()].map(p => p.seat));
    let seat = 0;
    while (taken.has(seat)) seat++;
    const name = (requestedName || '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 16) || `Drake ${seat + 1}`;
    const drake = this.spawnDrake(seat);
    this.players.set(link, { link, seat, name, drake, input: { ...NO_INPUT }, lastSeen: Date.now(), inputBudget: MAX_INPUTS_PER_SECOND, ack: -1, queue: [] });
    send(link, { t: 'welcome', v: PROTOCOL_VERSION, player: seat, colour: seat, room: this.name, seed: this.seed, tickHz: SERVER_TICK_HZ, level: this.layout.id, chapter: this.chapter });
    this.broadcastRoster();
    if (!this.stopTimer) {
      this.lastTimer = performance.now();
      this.owed = 0;
      this.stopTimer = every(1000 / SERVER_TICK_HZ, () => this.pump());
    }
    return true;
  }

  leave(link: Link) {
    const player = this.players.get(link);
    if (!player) return;
    this.players.delete(link);
    this.rampage.removeDrake(player.drake);
    this.world.destroy(player.drake.id);
    this.broadcastRoster();
    if (this.players.size === 0) {
      this.stopTimer?.();
      this.stopTimer = null;
      this.onEmpty(this);
    }
  }

  /** Stop the clock for good: the host is handing the room over or leaving. */
  close() {
    this.stopTimer?.();
    this.stopTimer = null;
    this.players.clear();
  }

  receive(link: Link, message: ClientMessage) {
    const player = this.players.get(link);
    if (!player) return;
    player.lastSeen = Date.now();
    switch (message.t) {
      case 'input':
        if (player.inputBudget <= 0) return;
        player.inputBudget--;
        // Out-of-order or duplicate inputs are stale.
        if (message.seq <= (player.queue.at(-1)?.seq ?? player.ack)) return;
        player.queue.push({ seq: message.seq, input: decodeInput(message, { ...NO_INPUT }) });
        while (player.queue.length > MAX_QUEUED_INPUTS) player.queue.shift();
        break;
      case 'restart':
        this.restart();
        break;
      case 'ping':
        send(link, { t: 'pong', at: message.at });
        break;
      default:
        break;
    }
  }

  private spawnDrake(seat: number) {
    const start = spawnFor(this.layout, seat);
    const drake = new DrakeSim(this.world, start.x, start.z, start.yaw, seat);
    this.rampage.addDrake(drake);
    return drake;
  }

  /** A fresh village for everyone in the room, same seats. */
  private restart() {
    this.world = new World();
    this.rng = new Rng(this.seed);
    // A bound chapter's level is already this.layout; a built-in reloads.
    if (!this.chapter) this.layout = getLevel(this.layout.id);
    this.rampage = new Rampage(this.world, this.rng, null, this.layout, true);
    for (const player of this.players.values()) {
      player.drake = this.spawnDrake(player.seat);
      player.queue.length = 0;
    }
    this.pending = [];
    this.tick = 0;
    this.broadcast({ t: 'restart', seed: this.seed, level: this.layout.id, chapter: this.chapter });
  }

  /**
   * Run as many fixed ticks as wall-clock time says are due. setInterval
   * drifts and stalls under load; counting real time keeps the simulation at
   * 30 Hz on average, and the cap stops a long stall turning into a burst.
   */
  private pump() {
    const now = performance.now();
    this.owed += now - this.lastTimer;
    this.lastTimer = now;
    const tickMs = 1000 / SERVER_TICK_HZ;
    let ran = 0;
    while (this.owed >= tickMs && ran < MAX_CATCH_UP_TICKS) {
      this.owed -= tickMs;
      this.step();
      ran++;
    }
    if (ran === MAX_CATCH_UP_TICKS) this.owed = 0;
  }

  private step() {
    const now = Date.now();
    for (const player of [...this.players.values()]) {
      if (now - player.lastSeen > IDLE_TIMEOUT_MS) {
        player.link.close(CLOSE_IDLE);
        this.leave(player.link);
      }
      // Refill a second's worth of input allowance a tick at a time.
      player.inputBudget = Math.min(MAX_INPUTS_PER_SECOND, player.inputBudget + MAX_INPUTS_PER_SECOND / SERVER_TICK_HZ);
    }
    if (this.players.size === 0) return;

    const bySeat = new Map<number, Input>();
    for (const player of this.players.values()) {
      // One queued input per tick; with none queued, the last one holds.
      const next = player.queue.shift();
      if (next) {
        player.input = next.input;
        player.ack = next.seq;
      }
      bySeat.set(player.seat, player.input);
    }
    this.rampage.tick(TICK, drake => bySeat.get(drake.player) ?? NO_INPUT);
    this.rampage.drainEvents(this.pending);
    this.tick++;
    if (this.tick % TICKS_PER_SNAPSHOT === 0) this.snapshot(bySeat);
  }

  private snapshot(inputs: Map<number, Input>) {
    const rampage = this.rampage;
    const acks = new Map([...this.players.values()].map(p => [p.seat, p.ack]));
    const drakes: DrakeRow[] = [];
    for (const drake of rampage.drakes) {
      if (!this.world.state.transform(drake.id, this.at)) continue;
      const held = inputs.get(drake.player)?.breathing ?? false;
      drakes.push([drake.player, cm(this.at.x), cm(this.at.z), deg(this.at.yaw), cm(drake.speed), (drake.breathed ? 1 : 0) | (held ? 2 : 0), acks.get(drake.player) ?? -1]);
    }
    const dwarves: DwarfRow[] = [];
    for (const dwarf of rampage.dwarves) {
      if (dwarf.dead || !this.world.state.transform(dwarf.id, this.at)) continue;
      dwarves.push([
        dwarf.id, cm(this.at.x), cm(this.at.y), cm(this.at.z), deg(this.at.yaw),
        Math.round(dwarf.burnRemainingSeconds * 10) / 10,
        (dwarf.airborne ? 1 : 0) | (dwarf.stunned ? 2 : 0),
        Math.round(dwarf.spin),
        dwarf.launches
      ]);
    }
    const props: PropRow[] = [];
    rampage.props.forEach((prop, index) => {
      if (prop.state !== 0) props.push([index, prop.state, Math.round(prop.burnElapsed * 10) / 10]);
    });
    const message: Snapshot = {
      t: 'snap',
      tick: this.tick,
      score: rampage.score,
      combo: rampage.combo,
      best: rampage.bestCombo,
      points: [...rampage.points.entries()],
      drakes,
      dwarves,
      props,
      events: this.pending
    };
    this.pending = [];
    this.broadcast(message);
  }

  private broadcastRoster() {
    const players: PlayerInfo[] = [...this.players.values()].map(p => ({ player: p.seat, name: p.name, colour: p.seat }));
    this.broadcast({ t: 'roster', players });
  }

  private broadcast(message: ServerMessage) {
    const data = JSON.stringify(message);
    for (const player of this.players.values()) {
      if (player.link.open) player.link.send(data);
    }
  }
}

const send = (link: Link, message: ServerMessage) => {
  if (link.open) link.send(JSON.stringify(message));
};

/** Stable seed per room name, so a room's dwarves are reproducible. */
const hashRoom = (name: string) => {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
};
