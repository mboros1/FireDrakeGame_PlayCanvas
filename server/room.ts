/**
 * One village, simulated authoritatively for up to four drakes.
 *
 * The room runs exactly the simulation the single-player client runs —
 * `Rampage` over a `World` — at a fixed 30 Hz, fed by each player's latest
 * input. Clients never send positions; they send button bits and a look
 * angle, and render what the room tells them. That is the contract
 * `docs/ARCHITECTURE.md` sets for the netcode, kept here in TypeScript so it
 * ships now; forge can replace the simulation behind the same messages.
 */

import type { WebSocket } from 'ws';
import { World } from '../src/sim/world';
import { Rng } from '../src/sim/random';
import { DrakeSim } from '../src/sim/drake';
import { Rampage, type RampageEvent } from '../src/sim/rampage';
import { buildVillageLayout, type VillageLayout } from '../src/sim/village';
import { NO_INPUT, type Input, type Transform } from '../src/sim/types';
import {
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
} from '../src/net/protocol';

const TICK = 1 / SERVER_TICK_HZ;
const TICKS_PER_SNAPSHOT = Math.round(SERVER_TICK_HZ / SNAPSHOT_HZ);
/** A player whose socket goes quiet this long is dropped. */
const IDLE_TIMEOUT_MS = 20_000;
/** Inputs arriving faster than this per second are ignored, not queued. */
const MAX_INPUTS_PER_SECOND = 90;

type Player = {
  socket: WebSocket;
  seat: number;
  name: string;
  drake: DrakeSim;
  input: Input;
  lastSeen: number;
  inputBudget: number;
};

export class Room {
  private world = new World();
  private rng: Rng;
  private layout: VillageLayout = buildVillageLayout();
  private rampage: Rampage;
  private readonly players = new Map<WebSocket, Player>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private pending: RampageEvent[] = [];
  private seed: number;
  private readonly at: Transform = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(readonly name: string, private readonly onEmpty: (room: Room) => void) {
    this.seed = hashRoom(name);
    this.rng = new Rng(this.seed);
    this.rampage = new Rampage(this.world, this.rng, null, this.layout, true);
  }

  get size() {
    return this.players.size;
  }

  join(socket: WebSocket, requestedName: string): boolean {
    if (this.players.size >= MAX_PLAYERS) {
      send(socket, { t: 'full' });
      return false;
    }
    const taken = new Set([...this.players.values()].map(p => p.seat));
    let seat = 0;
    while (taken.has(seat)) seat++;
    const name = (requestedName || '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 16) || `Drake ${seat + 1}`;
    const drake = this.spawnDrake(seat);
    this.players.set(socket, { socket, seat, name, drake, input: { ...NO_INPUT }, lastSeen: Date.now(), inputBudget: MAX_INPUTS_PER_SECOND });
    send(socket, { t: 'welcome', v: PROTOCOL_VERSION, player: seat, colour: seat, room: this.name, seed: this.seed, tickHz: SERVER_TICK_HZ });
    this.broadcastRoster();
    if (!this.timer) this.timer = setInterval(() => this.step(), 1000 / SERVER_TICK_HZ);
    return true;
  }

  leave(socket: WebSocket) {
    const player = this.players.get(socket);
    if (!player) return;
    this.players.delete(socket);
    this.rampage.removeDrake(player.drake);
    this.world.destroy(player.drake.id);
    this.broadcastRoster();
    if (this.players.size === 0) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.onEmpty(this);
    }
  }

  receive(socket: WebSocket, message: ClientMessage) {
    const player = this.players.get(socket);
    if (!player) return;
    player.lastSeen = Date.now();
    switch (message.t) {
      case 'input':
        if (player.inputBudget <= 0) return;
        player.inputBudget--;
        decodeInput(message, player.input);
        break;
      case 'restart':
        this.restart();
        break;
      case 'ping':
        send(socket, { t: 'pong', at: message.at });
        break;
      default:
        break;
    }
  }

  private spawnDrake(seat: number) {
    // Side by side on the road into the village.
    const start = this.layout.drakeStart;
    const offset = [0, -4, 4, -8][seat] ?? 0;
    const drake = new DrakeSim(this.world, start.x + offset, start.z + Math.abs(offset) * .4, start.yaw, seat);
    this.rampage.addDrake(drake);
    return drake;
  }

  /** A fresh village for everyone in the room, same seats. */
  private restart() {
    this.world = new World();
    this.rng = new Rng(this.seed);
    this.layout = buildVillageLayout();
    this.rampage = new Rampage(this.world, this.rng, null, this.layout, true);
    for (const player of this.players.values()) player.drake = this.spawnDrake(player.seat);
    this.pending = [];
    this.tick = 0;
    this.broadcast({ t: 'restart', seed: this.seed });
  }

  private step() {
    const now = Date.now();
    for (const player of [...this.players.values()]) {
      if (now - player.lastSeen > IDLE_TIMEOUT_MS) {
        player.socket.close(4000, 'idle');
        this.leave(player.socket);
      }
      // Refill a second's worth of input allowance a tick at a time.
      player.inputBudget = Math.min(MAX_INPUTS_PER_SECOND, player.inputBudget + MAX_INPUTS_PER_SECOND / SERVER_TICK_HZ);
    }
    if (this.players.size === 0) return;

    const bySeat = new Map<number, Input>();
    for (const player of this.players.values()) bySeat.set(player.seat, player.input);
    this.rampage.tick(TICK, drake => bySeat.get(drake.player) ?? NO_INPUT);
    this.rampage.drainEvents(this.pending);
    this.tick++;
    if (this.tick % TICKS_PER_SNAPSHOT === 0) this.snapshot(bySeat);
  }

  private snapshot(inputs: Map<number, Input>) {
    const rampage = this.rampage;
    const drakes: DrakeRow[] = [];
    for (const drake of rampage.drakes) {
      if (!this.world.state.transform(drake.id, this.at)) continue;
      const held = inputs.get(drake.player)?.breathing ?? false;
      drakes.push([drake.player, cm(this.at.x), cm(this.at.z), deg(this.at.yaw), cm(drake.speed), (drake.breathed ? 1 : 0) | (held ? 2 : 0)]);
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
      if (player.socket.readyState === 1) player.socket.send(data);
    }
  }
}

const send = (socket: WebSocket, message: ServerMessage) => {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
};

/** Stable seed per room name, so a room's dwarves are reproducible. */
const hashRoom = (name: string) => {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
};
