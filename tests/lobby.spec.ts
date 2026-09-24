import { expect, test } from '@playwright/test';
import { NetSession } from '../src/net/client';
import { localMesh } from '../src/net/mesh';
import { PROTOCOL_VERSION } from '../src/net/protocol';
import { getLevel } from '../src/sim/levels';
import { toLevelFile } from '../src/sim/level';
import { NO_INPUT } from '../src/sim/types';

/**
 * Rooms with no server: who hosts, who follows, and what happens when the
 * host leaves. Runs in Node over the BroadcastChannel mesh, so it needs no
 * network and no browser.
 */

const SEEK_MS = 300;
const sessions: NetSession[] = [];
const open = (room: string, name: string, chapter?: ReturnType<typeof toLevelFile>) => {
  const session = new NetSession(room, name, { mesh: localMesh, seekMs: SEEK_MS, chapter });
  sessions.push(session);
  // Keep inputs flowing as a playing client would, so nobody idles out.
  const timer = setInterval(() => session.step(NO_INPUT, { x: 0, z: 0, yaw: 0 }), 33);
  const close = session.close.bind(session);
  session.close = () => {
    clearInterval(timer);
    close();
  };
  return session;
};
const roomName = (tag: string) => `${tag}-${Math.random().toString(36).slice(2, 8)}`;

test.afterEach(() => {
  for (const session of sessions.splice(0)) session.close();
});

test('the first to arrive hosts; the next joins them', async () => {
  const room = roomName('pair');
  const a = open(room, 'Alpha');
  await expect.poll(() => a.status).toBe('open');
  await expect.poll(() => a.hosting).toBe(true);
  const b = open(room, 'Beta');
  await expect.poll(() => b.roster.length).toBe(2);
  await expect.poll(() => a.roster.length).toBe(2);
  expect(b.hosting).toBe(false);
  expect(new Set([a.player, b.player])).toEqual(new Set([0, 1]));
  // Snapshots reach the guest, dwarves and all.
  let snapshots = 0;
  b.onSnapshot = snapshot => {
    if (snapshot.dwarves.length > 0) snapshots++;
  };
  await expect.poll(() => snapshots).toBeGreaterThan(3);
});

test('when the host leaves, someone else takes up the book', async () => {
  const room = roomName('handover');
  const a = open(room, 'Alpha');
  await expect.poll(() => a.hosting).toBe(true);
  const b = open(room, 'Beta');
  const c = open(room, 'Gamma');
  await expect.poll(() => a.roster.length).toBe(3);
  let welcomes = 0;
  b.onWelcome = () => welcomes++;
  c.onWelcome = () => welcomes++;

  a.close();
  // Exactly one heir, and everyone left is in its room.
  await expect.poll(() => [b, c].filter(s => s.hosting).length, { timeout: 10_000 }).toBe(1);
  await expect.poll(() => b.roster.length, { timeout: 10_000 }).toBe(2);
  await expect.poll(() => c.roster.length).toBe(2);
  expect(b.status).toBe('open');
  expect(c.status).toBe('open');
  expect(welcomes).toBeGreaterThanOrEqual(2);
});

test('two players opening one room at once end up in one room', async () => {
  const room = roomName('race');
  const a = open(room, 'Alpha');
  const b = open(room, 'Beta');
  await expect.poll(() => [a, b].filter(s => s.hosting).length, { timeout: 10_000 }).toBe(1);
  await expect.poll(() => a.roster.length, { timeout: 10_000 }).toBe(2);
  await expect.poll(() => b.roster.length).toBe(2);
});

test('the opener chooses the chapter; everyone after gets it, even after a handover', async () => {
  const room = roomName('chapter');
  const chapter = { ...toLevelFile(getLevel()), id: 'chapter-abc', title: 'Two Cottages' };
  chapter.props = chapter.props.filter(p => p.kind === 'cottage').slice(0, 2);
  const a = open(room, 'Alpha', chapter);
  await expect.poll(() => a.chapter?.title).toBe('Two Cottages');
  // B asks for nothing, C asks for something else: the room's chapter wins.
  const b = open(room, 'Beta');
  const c = open(room, 'Gamma', { ...toLevelFile(getLevel()), title: 'Not This One' });
  await expect.poll(() => b.chapter?.title).toBe('Two Cottages');
  await expect.poll(() => c.chapter?.title).toBe('Two Cottages');
  a.close();
  await expect.poll(() => [b, c].filter(s => s.hosting).length, { timeout: 10_000 }).toBe(1);
  await expect.poll(() => b.roster.length, { timeout: 10_000 }).toBe(2);
  expect(b.chapter?.title).toBe('Two Cottages');
  expect(c.chapter?.title).toBe('Two Cottages');
  expect(b.chapter?.props.length).toBe(2);
});

test('a fifth drake is told the room is full', async () => {
  const room = roomName('full');
  const first = open(room, 'One');
  await expect.poll(() => first.hosting).toBe(true);
  const rest = ['Two', 'Three', 'Four'].map(name => open(room, name));
  await expect.poll(() => first.roster.length).toBe(4);
  const fifth = open(room, 'Five');
  await expect.poll(() => fifth.status).toBe('full');
  expect(rest.every(s => s.status === 'open')).toBe(true);
});

test('a different edition hosting the room is refused, not misread', async () => {
  const room = roomName('edition');
  const old = await localMesh(room);
  const claim = setInterval(() => old.send(JSON.stringify({ k: 'host', v: PROTOCOL_VERSION - 1, n: 1 })), 100);
  try {
    const a = open(room, 'Alpha');
    await expect.poll(() => a.status).toBe('outdated');
    expect(a.hosting).toBe(false);
  } finally {
    clearInterval(claim);
    old.leave();
  }
});
