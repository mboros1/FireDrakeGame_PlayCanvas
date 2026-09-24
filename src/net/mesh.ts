/**
 * The peers in a room: who is here, and a way to pass them strings.
 *
 * Two kinds, one interface:
 *
 * - **{@link nostrMesh}**, what players get: WebRTC data channels between
 *   every pair of players, found through public Nostr relays by Trystero.
 *   Nothing of ours runs anywhere. The relays only carry the handshake;
 *   game traffic goes browser to browser. STUN is public too, and there is
 *   no TURN relay, so a few strict networks cannot connect at all.
 * - **{@link localMesh}**, for tests and local development
 *   (`?signal=local`): tabs of one browser, over a BroadcastChannel. No
 *   network, so the test suite does not depend on strangers' relays.
 *
 * Neither has any notion of hosting; `lobby.ts` builds that on top.
 */

export interface Mesh {
  readonly selfId: string;
  /** Everyone currently connected, not including this player. */
  peers(): string[];
  /** To one peer, or to everyone. */
  send(data: string, to?: string): void;
  onMessage: (from: string, data: string) => void;
  onJoin: (peer: string) => void;
  onLeave: (peer: string) => void;
  leave(): void;
}

export type MeshFactory = (room: string) => Promise<Mesh>;

/** Namespaces this game's rooms on the relays, apart from every other Trystero app. */
const APP_ID = 'fire-drake-simulator';

export const nostrMesh: MeshFactory = async room => {
  // Loaded on demand: single player never pays for it.
  const { joinRoom, selfId } = await import('trystero/nostr');
  const trystero = joinRoom({ appId: APP_ID }, room);
  const action = trystero.makeAction<string>('fd');
  const peers = new Set<string>();
  const mesh: Mesh = {
    selfId,
    peers: () => [...peers],
    send: (data, to) => void action.send(data, to ? { target: to } : undefined).catch(() => {}),
    onMessage: () => {},
    onJoin: () => {},
    onLeave: () => {},
    leave: () => void trystero.leave().catch(() => {})
  };
  action.onMessage = (data, context) => {
    if (typeof data === 'string') mesh.onMessage(context.peerId, data);
  };
  trystero.onPeerJoin = peer => {
    peers.add(peer);
    mesh.onJoin(peer);
  };
  trystero.onPeerLeave = peer => {
    if (peers.delete(peer)) mesh.onLeave(peer);
  };
  return mesh;
};

type LocalPacket = { from: string; to?: string; kind: 'here' | 'hello' | 'bye' | 'data'; data?: string };

/** A peer not heard from for this long has closed its tab without saying so. */
const LOCAL_TIMEOUT_MS = 3000;

export const localMesh: MeshFactory = async room => {
  const selfId = Math.random().toString(36).slice(2, 12);
  const channel = new BroadcastChannel(`fire-drake:${room}`);
  const lastHeard = new Map<string, number>();
  const post = (packet: Omit<LocalPacket, 'from'>) => channel.postMessage({ ...packet, from: selfId });
  const mesh: Mesh = {
    selfId,
    peers: () => [...lastHeard.keys()],
    send: (data, to) => post({ kind: 'data', data, to }),
    onMessage: () => {},
    onJoin: () => {},
    onLeave: () => {},
    leave: () => {
      clearInterval(heartbeat);
      post({ kind: 'bye' });
      channel.close();
      if (typeof removeEventListener === 'function') removeEventListener('pagehide', bye);
    }
  };
  const heard = (peer: string) => {
    const known = lastHeard.has(peer);
    lastHeard.set(peer, Date.now());
    if (!known) mesh.onJoin(peer);
  };
  const gone = (peer: string) => {
    if (lastHeard.delete(peer)) mesh.onLeave(peer);
  };
  channel.onmessage = event => {
    const packet = event.data as LocalPacket;
    if (!packet || packet.from === selfId || (packet.to && packet.to !== selfId)) return;
    if (packet.kind === 'bye') return gone(packet.from);
    // Answer a newcomer directly, so both sides learn of each other at once.
    if (packet.kind === 'hello') post({ kind: 'here', to: packet.from });
    heard(packet.from);
    if (packet.kind === 'data' && typeof packet.data === 'string') mesh.onMessage(packet.from, packet.data);
  };
  const heartbeat = setInterval(() => {
    post({ kind: 'here' });
    const now = Date.now();
    for (const [peer, at] of lastHeard) if (now - at > LOCAL_TIMEOUT_MS) gone(peer);
  }, 500);
  const bye = () => post({ kind: 'bye' });
  if (typeof addEventListener === 'function') addEventListener('pagehide', bye);
  post({ kind: 'hello' });
  return mesh;
};
