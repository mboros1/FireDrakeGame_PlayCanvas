/**
 * A multiplayer session, from the frame loop's point of view.
 *
 * Owns everything that differs from single player:
 *
 * - **The local drake is predicted** in fixed steps at the room's tick rate,
 *   with the same `Rampage` movement and prop collision the host runs, then
 *   reconciled against the host's acknowledged position. (The host predicts
 *   too: its own drake reaches the room over a loopback, like anyone's.) It is drawn
 *   between prediction steps, with any correction faded out over a few
 *   frames rather than snapped.
 * - **Other drakes** are replicas: a `DrakeSim` placed from interpolated
 *   snapshots, drawn by an ordinary `DrakeView` in the player's colour.
 * - **Dwarves and props** are replicas too, fed into the replica `Rampage` so
 *   the existing puppets, stage and HUD draw them unchanged.
 * - **Events** arrive in snapshots and go to the same handler single player
 *   uses, so narration, sound, deeds and pops need no network awareness.
 */

import * as pc from 'playcanvas';
import { NetSession, type NetStatus, type SessionOptions } from './net/client';
import { PLAYER_COLOURS, SERVER_TICK_HZ, type PlayerInfo, type Snapshot } from './net/protocol';
import { DrakeSim } from './sim/drake';
import { DwarfSim } from './sim/dwarf';
import { Rng } from './sim/random';
import type { Rampage, RampageEvent } from './sim/rampage';
import type { Input, Transform } from './sim/types';
import type { World } from './sim/world';
import { DrakeView } from './view/drake';
import type { Fx } from './view/fx';

const STEP = 1 / SERVER_TICK_HZ;
/** Beyond this, the prediction is wrong enough to snap rather than ease. */
const SNAP_DISTANCE = 6;
/** Visual correction decays at this rate, per second. */
const CORRECTION_DECAY = 12;
/** Matches the sim's breath interval, for drawing remote breath locally. */
const REMOTE_BREATH_INTERVAL = .055;

type Remote = { sim: DrakeSim; view: DrakeView; tag: HTMLDivElement; breathCooldown: number };

export type PartyDeps = {
  app: pc.AppBase;
  world: pc.Entity;
  simWorld: World;
  drake: DrakeSim;
  drakeView: DrakeView;
  fx: Fx;
  camera: pc.Entity;
  rampage: () => Rampage;
  /** Rebuild the village replica: first join, every restart, every change of host. */
  rebuild: () => void;
  events: (events: RampageEvent[]) => void;
  status: (status: NetStatus, detail: string) => void;
};

export class Party {
  readonly session: NetSession;
  private readonly remotes = new Map<number, Remote>();
  private readonly replicaDwarves = new Map<number, DwarfSim>();
  private readonly dwarfRng = new Rng(1);
  private accumulator = 0;
  private readonly previous: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly current: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly offset = { x: 0, z: 0, yaw: 0 };
  private readonly input: Input = { forward: 0, right: 0, charging: false, breathing: false, cameraYaw: 0 };
  private latest: Snapshot | null = null;
  private ready = false;
  private readonly screen = new pc.Vec3();
  private readonly mouth = new pc.Vec3();
  private readonly roster = document.querySelector<HTMLDivElement>('#party')!;
  private readonly tags = document.querySelector<HTMLDivElement>('#party-tags')!;
  /** Largest correction applied, for the debug surface. */
  lastCorrection = 0;

  constructor(private readonly deps: PartyDeps, readonly room: string, name: string, options: SessionOptions) {
    this.session = new NetSession(room, name, options);
    this.session.onWelcome = () => {
      this.ready = true;
      deps.rebuild();
      this.renderRoster(this.session.roster);
    };
    this.session.onRestart = () => deps.rebuild();
    this.session.onSnapshot = snapshot => this.receive(snapshot);
    this.session.onRoster = roster => this.renderRoster(roster);
    this.session.onStatus = status => {
      const detail = {
        connecting: `Looking for room ${room}…`,
        open: this.session.hosting ? `You hold the book for room ${room}. Share the code; friends' drakes arrive as they join.` : `Joined room ${room}.`,
        reconnecting: 'The one holding the book has gone. Someone else takes it up, and the page begins again…',
        closed: 'The connection to the story was lost. Refresh to rejoin.',
        full: `Room ${room} is full: four drakes is the limit.`,
        outdated: 'Someone in this room reads a different edition of the book. Everyone should refresh the page.'
      }[status];
      deps.status(status, detail);
      this.renderRoster(this.session.roster);
    };
    this.roster.classList.remove('hidden');
  }

  get seat() {
    return this.session.player;
  }

  get colour() {
    return PLAYER_COLOURS[Math.max(0, this.seat) % PLAYER_COLOURS.length];
  }

  get connected() {
    return this.ready && this.session.status === 'open';
  }

  /** Waiting to rejoin after a drop: the world is frozen, not over. */
  get reconnecting() {
    return this.session.status === 'reconnecting';
  }

  /** Called after the village replica is (re)built. */
  onRebuilt() {
    this.accumulator = 0;
    this.offset.x = this.offset.z = this.offset.yaw = 0;
    this.deps.simWorld.state.transform(this.deps.drake.id, this.current);
    Object.assign(this.previous, this.current);
    // Replica dwarves belonged to the old world.
    this.replicaDwarves.clear();
    this.deps.drakeView.setTint(this.colour.tint);
    for (const remote of this.remotes.values()) this.dropRemote(remote);
    this.remotes.clear();
  }

  /**
   * Advance one rendered frame: fixed prediction steps for the local drake,
   * reconciliation, and replicas for everything else.
   */
  update(frameDt: number, elapsed: number, read: () => Input) {
    const { drake, simWorld } = this.deps;
    if (!this.connected) return;
    const rampage = this.deps.rampage();

    // Fixed-step prediction, exactly one input per step, as the host does.
    this.accumulator = Math.min(this.accumulator + frameDt, STEP * 8);
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      Object.assign(this.input, read());
      Object.assign(this.previous, this.current);
      rampage.predict(drake, STEP, this.input);
      simWorld.state.transform(drake.id, this.current);
      this.session.step(this.input, this.current);
    }

    // Reconcile against the host's view of our last acknowledged input.
    const correction = this.session.reconciliation();
    if (correction) {
      const distance = Math.hypot(correction.dx, correction.dz);
      this.lastCorrection = distance;
      if (distance > SNAP_DISTANCE) {
        drake.nudge(simWorld, correction.dx, correction.dz, correction.dyaw);
        simWorld.state.transform(drake.id, this.current);
        Object.assign(this.previous, this.current);
        this.offset.x = this.offset.z = this.offset.yaw = 0;
      } else if (distance > .005 || Math.abs(correction.dyaw) > .1) {
        drake.nudge(simWorld, correction.dx, correction.dz, correction.dyaw);
        this.current.x += correction.dx;
        this.current.z += correction.dz;
        this.current.yaw += correction.dyaw;
        this.previous.x += correction.dx;
        this.previous.z += correction.dz;
        this.previous.yaw += correction.dyaw;
        // Keep drawing where we were; let the difference fade.
        this.offset.x -= correction.dx;
        this.offset.z -= correction.dz;
        this.offset.yaw -= correction.dyaw;
      }
    }
    const decay = Math.exp(-CORRECTION_DECAY * frameDt);
    this.offset.x *= decay;
    this.offset.z *= decay;
    this.offset.yaw *= decay;
    const alpha = this.accumulator / STEP;
    this.deps.drakeView.renderOverride = {
      x: pc.math.lerp(this.previous.x, this.current.x, alpha) + this.offset.x,
      z: pc.math.lerp(this.previous.z, this.current.z, alpha) + this.offset.z,
      yaw: this.previous.yaw + (((this.current.yaw - this.previous.yaw + 540) % 360) - 180) * alpha + this.offset.yaw
    };

    this.syncReplicas(rampage, frameDt, elapsed);
  }

  private receive(snapshot: Snapshot) {
    this.latest = snapshot;
    if (!this.ready) return;
    const rampage = this.deps.rampage();
    rampage.score = snapshot.score;
    rampage.combo = snapshot.combo;
    rampage.bestCombo = snapshot.best;
    rampage.points.clear();
    for (const [player, points] of snapshot.points) rampage.points.set(player, points);
    // Props: every non-intact prop is listed; state is authoritative.
    for (const [index, state, burnElapsed] of snapshot.props) {
      rampage.props[index]?.applyReplica(this.deps.simWorld, state, burnElapsed);
    }
    if (snapshot.events.length > 0) this.deps.events(snapshot.events);
    this.renderRoster(this.session.roster);
  }

  private syncReplicas(rampage: Rampage, frameDt: number, elapsed: number) {
    const sample = this.session.sample(performance.now());
    if (!sample) return;
    const { simWorld } = this.deps;

    // Remote drakes.
    const seen = new Set<number>();
    for (const remote of sample.drakes) {
      seen.add(remote.player);
      let entry = this.remotes.get(remote.player);
      if (!entry) entry = this.addRemote(remote.player, remote.x, remote.z, remote.yaw);
      entry.sim.place(simWorld, remote.x, remote.z, remote.yaw);
      entry.sim.speed = remote.speed;
      entry.breathCooldown -= frameDt;
      entry.sim.breathed = remote.breathing && entry.breathCooldown <= 0;
      if (entry.sim.breathed) entry.breathCooldown = REMOTE_BREATH_INTERVAL;
      entry.view.breathHeld = remote.breathing;
      entry.view.update(simWorld.state, frameDt, elapsed);
      if (entry.sim.breathed) {
        entry.view.mouthPosition(this.mouth);
        this.deps.fx.breath(this.mouth, new pc.Vec3(entry.sim.forwardX, -.04, entry.sim.forwardZ), pc.Vec3.ZERO);
      }
      this.placeTag(entry);
    }
    for (const [player, entry] of this.remotes) {
      if (!seen.has(player)) {
        this.dropRemote(entry);
        this.remotes.delete(player);
      }
    }

    // Replica dwarves: the host's list is the truth.
    const present = new Set<number>();
    for (const d of sample.dwarves) {
      present.add(d.id);
      let dwarf = this.replicaDwarves.get(d.id);
      if (!dwarf) {
        dwarf = new DwarfSim(simWorld, this.dwarfRng, d.x, d.z);
        this.replicaDwarves.set(d.id, dwarf);
        rampage.dwarves.push(dwarf);
      }
      dwarf.applyReplica(simWorld, d);
    }
    for (const [id, dwarf] of this.replicaDwarves) {
      if (present.has(id)) continue;
      this.replicaDwarves.delete(id);
      dwarf.dead = true;
      simWorld.destroy(dwarf.id);
      const index = rampage.dwarves.indexOf(dwarf);
      if (index >= 0) rampage.dwarves.splice(index, 1);
    }
  }

  private addRemote(player: number, x: number, z: number, yaw: number): Remote {
    const sim = new DrakeSim(this.deps.simWorld, x, z, yaw, player);
    const view = new DrakeView(this.deps.app, sim, this.deps.world);
    const colour = PLAYER_COLOURS[player % PLAYER_COLOURS.length];
    view.setTint(colour.tint);
    const tag = document.createElement('div');
    tag.className = 'party-tag';
    tag.style.setProperty('--colour', colour.css);
    tag.textContent = this.session.roster.find(p => p.player === player)?.name ?? colour.name;
    this.tags.appendChild(tag);
    const remote = { sim, view, tag, breathCooldown: 0 };
    this.remotes.set(player, remote);
    return remote;
  }

  private dropRemote(remote: Remote) {
    remote.view.destroy();
    remote.tag.remove();
    this.deps.simWorld.destroy(remote.sim.id);
  }

  private placeTag(remote: Remote) {
    const at = remote.view.root.getPosition();
    this.screen.set(at.x, at.y + 3.3, at.z);
    this.deps.camera.camera!.worldToScreen(this.screen, this.screen);
    const visible = this.screen.z > 0;
    remote.tag.style.opacity = visible ? '1' : '0';
    remote.tag.style.transform = `translate(${this.screen.x}px, ${this.screen.y}px) translate(-50%, -100%)`;
    const name = this.session.roster.find(p => p.player === remote.sim.player)?.name;
    if (name && remote.tag.textContent !== name) remote.tag.textContent = name;
  }

  private renderRoster(roster: PlayerInfo[]) {
    const points = new Map(this.latest?.points ?? []);
    const status = this.session.status;
    const rows = roster
      .slice()
      .sort((a, b) => a.player - b.player)
      .map(p => {
        const colour = PLAYER_COLOURS[p.colour % PLAYER_COLOURS.length];
        const you = p.player === this.seat ? ' <em>(you)</em>' : '';
        return `<li style="--colour:${colour.css}"><span class="party-dot"></span><span class="party-name">${escapeHtml(p.name)}${you}</span><span class="party-points">${points.get(p.player) ?? 0}</span></li>`;
      })
      .join('');
    const ping = this.session.hosting ? ' · you hold the book' : this.session.latencyMs ? ` · ${Math.round(this.session.latencyMs)} ms` : '';
    this.roster.innerHTML = `<div class="party-room">Room <b>${escapeHtml(this.room)}</b>${status === 'open' ? ping : ''}</div>` +
      `<ol class="party-list">${rows}</ol>` +
      (status === 'open' ? '<div class="party-hint">share the room code with friends</div>' : `<div class="party-hint">${status}</div>`);
  }

  destroy() {
    this.session.close();
    for (const remote of this.remotes.values()) this.dropRemote(remote);
    this.remotes.clear();
    this.roster.classList.add('hidden');
    this.deps.drakeView.renderOverride = null;
  }
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
