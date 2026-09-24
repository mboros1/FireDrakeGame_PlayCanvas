/**
 * Who hosts the room, and the wires between each player and that host.
 *
 * There is no server: one player's browser runs the room's {@link Room}
 * (the authoritative simulation) and everyone else plays against it, exactly
 * as they used to play against the server. The rules, all local and all
 * deterministic, so every peer reaches the same answer without asking:
 *
 * - **Arriving**, listen for a host for a moment. Someone answers: join
 *   them. Nobody does: host, and say so to everyone.
 * - **Two hosts** (two people opened the room at once, or a slow handshake):
 *   the one with guests wins; between equals, the lower peer id wins. The
 *   loser tells its guests where to go and joins the winner too.
 * - **The host leaves:** the lowest remaining peer id hosts a fresh page of
 *   the same chapter. The village restarts; that is the price of having no
 *   server, and the narrator says so.
 *
 * The host is also a player, over a loopback {@link Link}, so it runs the
 * same client code as everyone else.
 */

import { Room, type Link } from './room';
import type { Mesh, MeshFactory } from './mesh';
import { CLOSE_FULL, CLOSE_OUTDATED, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';
import { validateLevel, type LevelDefinition, type LevelFile } from '../sim/level';

/** What peers say to each other, wrapped around the room's own messages. */
type Wire =
  /** "I host this room", with how many play in it. */
  | { k: 'host'; v: number; n: number }
  /** Player to host. */
  | { k: 'c'; m: ClientMessage }
  /** Host to player. */
  | { k: 's'; m: ServerMessage }
  /** Host to player: you are out, for this reason. */
  | { k: 'shut'; code: number }
  /** A host that stepped down, to its players: follow me to this one. */
  | { k: 'moved'; to: string };

export type LobbyEvents = {
  /** A host is ready to hear `hello`: the first, or the next after a change. */
  connected(): void;
  message(message: ServerMessage): void;
  /** The host is gone; looking for the next. */
  lost(): void;
  /** Shut out by the host, with a close code from `protocol.ts`. */
  shut(code: number): void;
};

export type LobbyOptions = {
  /** How long to listen for an existing host before hosting. */
  seekMs: number;
  /** Nothing from the host this long means it is gone, whatever the mesh says. Default {@link SILENCE_MS}. */
  silenceMs?: number;
};

/**
 * A guest that hears nothing from its host this long (15 snapshots a second
 * is the norm, even from a background tab) takes it as gone. WebRTC notices
 * a vanished peer much more slowly on its own.
 */
const SILENCE_MS = 5000;
/** Hosts repeat their claim this often, for anyone who missed it. */
const CLAIM_EVERY_MS = 3000;
/** Wire messages beyond this are dropped unread. A welcome with a full chapter is ~15 KB. */
const MAX_WIRE_CHARS = 512 * 1024;

export class Lobby {
  role: 'seeking' | 'host' | 'guest' = 'seeking';
  hostId: string | null = null;
  /** Times the room has changed hands under this player, for the debug surface. */
  handovers = 0;

  private mesh: Mesh | null = null;
  private room: Room | null = null;
  private readonly links = new Map<string, Link>();
  private seekTimer: ReturnType<typeof setTimeout> | null = null;
  private claimTimer: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private heardFromHost = 0;
  private closed = false;
  private pagehide: (() => void) | null = null;

  constructor(
    private readonly factory: MeshFactory,
    readonly roomName: string,
    /** The chapter this room plays: the opener's choice, then whatever the host says. */
    private chapter: LevelFile | undefined,
    private readonly events: LobbyEvents,
    private readonly options: LobbyOptions
  ) {}

  get selfId() {
    return this.mesh?.selfId ?? '';
  }

  get hosting() {
    return this.role === 'host';
  }

  async start() {
    // Closing the tab says goodbye at once, rather than leaving the others
    // to notice the silence.
    if (!this.pagehide && typeof addEventListener === 'function') {
      this.pagehide = () => this.leave();
      addEventListener('pagehide', this.pagehide);
    }
    const mesh = await this.factory(this.roomName);
    if (this.closed) return mesh.leave();
    this.mesh = mesh;
    mesh.onMessage = (from, data) => this.receive(from, data);
    mesh.onJoin = peer => {
      if (this.role === 'host') this.claim(peer);
    };
    mesh.onLeave = peer => this.peerLeft(peer);
    this.seek();
    this.watchdog = setInterval(() => {
      const silence = this.options.silenceMs ?? SILENCE_MS;
      if (this.role === 'guest' && performance.now() - this.heardFromHost > silence) this.hostGone(this.hostId);
    }, 1000);
  }

  /** A message from this player's client, to wherever the room is. */
  send(message: ClientMessage) {
    if (this.role === 'host') this.fromPlayer(this.selfId, message);
    else if (this.role === 'guest' && this.hostId) this.mesh?.send(JSON.stringify({ k: 'c', m: message } satisfies Wire), this.hostId);
  }

  leave() {
    this.closed = true;
    if (this.pagehide) removeEventListener('pagehide', this.pagehide);
    this.stopHosting();
    this.clearTimers();
    if (this.watchdog) clearInterval(this.watchdog);
    this.mesh?.leave();
    this.mesh = null;
  }

  /** Debug: vanish from the mesh as a dropped network would, then find the room again. */
  async simulateDrop() {
    this.stopHosting();
    this.clearTimers();
    this.mesh?.leave();
    this.mesh = null;
    this.role = 'seeking';
    this.hostId = null;
    this.events.lost();
    await new Promise(resolve => setTimeout(resolve, 500));
    if (this.watchdog) clearInterval(this.watchdog);
    if (!this.closed) await this.start();
  }

  // ── Finding a host ────────────────────────────────────────────────────────

  private seek(ms = this.options.seekMs) {
    this.role = 'seeking';
    this.hostId = null;
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekTimer = setTimeout(() => this.becomeHost(), ms);
  }

  private becomeHost() {
    this.clearTimers();
    this.role = 'host';
    this.hostId = this.selfId;
    let level: LevelDefinition | undefined;
    try {
      level = this.chapter ? validateLevel(this.chapter) : undefined;
    } catch {
      level = undefined;
    }
    this.room = new Room(this.roomName, () => {}, level);
    this.claim();
    this.claimTimer = setInterval(() => this.claim(), CLAIM_EVERY_MS);
    this.events.connected();
  }

  private becomeGuest(host: string) {
    const wasHosting = this.role === 'host';
    this.stopHosting();
    this.clearTimers();
    this.role = 'guest';
    this.hostId = host;
    this.heardFromHost = performance.now();
    if (wasHosting) this.handovers++;
    this.events.connected();
  }

  /** Tell one peer, or everyone, that this player hosts. */
  private claim(to?: string) {
    const players = this.links.size;
    this.mesh?.send(JSON.stringify({ k: 'host', v: PROTOCOL_VERSION, n: players } satisfies Wire), to);
  }

  /** Does the other host's room outrank ours? Both sides compute the same answer. */
  private outranks(other: string, theirPlayers: number) {
    const theirs = theirPlayers > 1;
    const ours = this.links.size > 1;
    if (theirs !== ours) return theirs;
    return other < this.selfId;
  }

  private peerLeft(peer: string) {
    const link = this.links.get(peer);
    if (link && this.room) {
      this.room.leave(link);
      this.links.delete(peer);
    }
    if (this.role === 'guest' && peer === this.hostId) this.hostGone(peer);
  }

  /** The host left or fell silent: the lowest id left hosts, everyone else looks for them. */
  private hostGone(host: string | null) {
    if (!this.mesh) return;
    this.handovers++;
    this.events.lost();
    const candidates = [...this.mesh.peers().filter(p => p !== host), this.selfId].sort();
    if (candidates[0] === this.selfId) this.becomeHost();
    // Give the heir a moment; if they never claim, host rather than wait forever.
    else this.seek(this.options.seekMs * 2);
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  private receive(from: string, data: string) {
    if (data.length > MAX_WIRE_CHARS) return;
    let wire: Wire;
    try {
      wire = JSON.parse(data);
    } catch {
      return;
    }
    if (!wire || typeof wire !== 'object') return;
    switch (wire.k) {
      case 'host':
        return this.hostClaimed(from, wire);
      case 'c':
        if (this.role === 'host' && wire.m && typeof wire.m.t === 'string') this.fromPlayer(from, wire.m);
        return;
      case 's':
        if (this.role !== 'guest' || from !== this.hostId || !wire.m || typeof wire.m.t !== 'string') return;
        this.heardFromHost = performance.now();
        this.fromHost(wire.m);
        return;
      case 'shut':
        if (from === this.hostId && this.role === 'guest') this.events.shut(Number(wire.code));
        return;
      case 'moved':
        if (from === this.hostId && typeof wire.to === 'string' && this.mesh?.peers().includes(wire.to)) this.becomeGuest(wire.to);
        else if (from === this.hostId) this.hostGone(from);
        return;
      default:
        return;
    }
  }

  private hostClaimed(from: string, wire: Extract<Wire, { k: 'host' }>) {
    if (wire.v !== PROTOCOL_VERSION) {
      // A different edition hosts here. Only a seeker cares: it cannot join.
      if (this.role === 'seeking') {
        this.clearTimers();
        this.events.shut(CLOSE_OUTDATED);
      }
      return;
    }
    if (this.role === 'seeking') return this.becomeGuest(from);
    if (this.role === 'guest') {
      // Our host is still here: the hosts will settle it between them.
      if (from !== this.hostId && !this.mesh?.peers().includes(this.hostId ?? '')) this.becomeGuest(from);
      return;
    }
    // Two hosts. The lesser steps down and sends its players along.
    if (this.outranks(from, Number(wire.n) || 0)) {
      for (const peer of this.links.keys()) {
        if (peer !== this.selfId) this.mesh?.send(JSON.stringify({ k: 'moved', to: from } satisfies Wire), peer);
      }
      this.becomeGuest(from);
    } else {
      this.claim(from);
    }
  }

  private fromHost(message: ServerMessage) {
    // Remember the room's chapter, in case this player has to host it next.
    if (message.t === 'welcome' || message.t === 'restart') this.chapter = message.chapter;
    this.events.message(message);
  }

  /** On the host: a message from a player (or from ourselves) into the room. */
  private fromPlayer(peer: string, message: ClientMessage) {
    const room = this.room;
    if (!room) return;
    if (message.t === 'hello') {
      const previous = this.links.get(peer);
      if (previous) {
        room.leave(previous);
        this.links.delete(peer);
      }
      const link = peer === this.selfId ? this.loopback() : this.remote(peer);
      if (message.v !== PROTOCOL_VERSION) return link.close(CLOSE_OUTDATED);
      if (!room.join(link, message.name)) return link.close(CLOSE_FULL);
      this.links.set(peer, link);
      return;
    }
    const link = this.links.get(peer);
    if (link) room.receive(link, message);
  }

  private remote(peer: string): Link {
    const link = {
      open: true,
      send: (data: string) => this.mesh?.send(`{"k":"s","m":${data}}`, peer),
      close: (code: number) => {
        link.open = false;
        this.mesh?.send(JSON.stringify({ k: 'shut', code } satisfies Wire), peer);
      }
    };
    return link;
  }

  /** The host's own player: the room's messages, delivered in-process. */
  private loopback(): Link {
    const link = {
      open: true,
      send: (data: string) => {
        const message = JSON.parse(data) as ServerMessage;
        queueMicrotask(() => {
          if (link.open && this.role === 'host') this.fromHost(message);
        });
      },
      close: (code: number) => {
        link.open = false;
        queueMicrotask(() => this.events.shut(code));
      }
    };
    return link;
  }

  private stopHosting() {
    if (this.claimTimer) clearInterval(this.claimTimer);
    this.claimTimer = null;
    for (const link of this.links.values()) (link as { open: boolean }).open = false;
    this.links.clear();
    this.room?.close();
    this.room = null;
  }

  private clearTimers() {
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekTimer = null;
  }
}
