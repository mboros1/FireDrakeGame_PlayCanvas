import { expect, test } from '@playwright/test';
import { World } from '../src/sim/world';
import {
  EntityFlags,
  EntityKind,
  TRANSFORM_STRIDE,
  type EntityId,
  type Transform
} from '../src/sim/types';

const out = (): Transform => ({ x: 0, y: 0, z: 0, yaw: 0 });

test('resolves live handles and reports their state', () => {
  const world = new World();
  const drake = world.spawn(EntityKind.Drake, 1, 2, 3, 45);

  const t = out();
  expect(world.state.transform(drake, t)).toBe(true);
  expect(t).toEqual({ x: 1, y: 2, z: 3, yaw: 45 });
  expect(world.state.kind(drake)).toBe(EntityKind.Drake);
  expect(world.state.entityCount()).toBe(1);
});

test('a destroyed handle stops resolving', () => {
  const world = new World();
  const dwarf = world.spawn(EntityKind.Dwarf, 0, 0, 0);

  expect(world.destroy(dwarf)).toBe(true);
  expect(world.isLive(dwarf)).toBe(false);
  expect(world.state.transform(dwarf, out())).toBe(false);
  expect(world.state.entityCount()).toBe(0);
  // Double-destroy is a no-op rather than corruption.
  expect(world.destroy(dwarf)).toBe(false);
});

test('a recycled slot does not answer to the old handle', () => {
  // The property the renderer depends on: without generation checking, a
  // despawned dwarf's id would silently start referring to whichever entity
  // next took its slot, and the view would keep drawing the old entity as the
  // new one.
  const world = new World();
  const first = world.spawn(EntityKind.Dwarf, 5, 0, 5);
  world.destroy(first);
  const second = world.spawn(EntityKind.BreathParticle, 9, 9, 9);

  expect(second).not.toBe(first);
  expect(world.isLive(first)).toBe(false);
  expect(world.state.transform(first, out())).toBe(false);
  expect(world.isLive(second)).toBe(true);
  expect(world.state.kind(second)).toBe(EntityKind.BreathParticle);
});

test('swap-remove keeps every surviving handle valid', () => {
  const world = new World();
  const ids = [0, 1, 2, 3, 4].map(i =>
    world.spawn(EntityKind.Dwarf, i, 0, -i, i * 10)
  );

  // Destroy from the front, so the tail entity is swapped into the hole.
  world.destroy(ids[0]);
  world.destroy(ids[2]);

  expect(world.state.entityCount()).toBe(3);
  const t = out();
  for (const i of [1, 3, 4]) {
    expect(world.state.transform(ids[i], t)).toBe(true);
    expect(t.x).toBe(i);
    expect(t.z).toBe(-i);
    expect(t.yaw).toBe(i * 10);
  }
  for (const i of [0, 2]) {
    expect(world.state.transform(ids[i], out())).toBe(false);
  }
});

test('exports a dense transform buffer with yaw as a Y-axis quaternion', () => {
  const world = new World();
  world.spawn(EntityKind.Drake, 1, 2, 3, 0);
  world.spawn(EntityKind.Dwarf, 4, 5, 6, 180);

  const buffer = world.state.transforms();
  expect(world.state.entityCount()).toBe(2);

  expect(Array.from(buffer.slice(0, 3))).toEqual([1, 2, 3]);
  // Identity rotation.
  expect(buffer[3]).toBeCloseTo(0);
  expect(buffer[4]).toBeCloseTo(0);
  expect(buffer[5]).toBeCloseTo(0);
  expect(buffer[6]).toBeCloseTo(1);

  const second = TRANSFORM_STRIDE;
  expect(Array.from(buffer.slice(second, second + 3))).toEqual([4, 5, 6]);
  // 180 degrees about Y: sin(90) = 1, cos(90) = 0.
  expect(buffer[second + 4]).toBeCloseTo(1);
  expect(buffer[second + 6]).toBeCloseTo(0);
});

test('every render slot correlates back to its entity', () => {
  const world = new World();
  const ids = [
    world.spawn(EntityKind.Drake, 0, 0, 0),
    world.spawn(EntityKind.Dwarf, 1, 0, 0),
    world.spawn(EntityKind.Dwarf, 2, 0, 0)
  ];
  world.destroy(ids[0]);

  const seen = new Set<number>();
  for (let slot = 0; slot < world.state.entityCount(); slot++) {
    const id = world.state.idsAt(slot);
    expect(world.isLive(id)).toBe(true);
    seen.add(id);
  }
  expect(seen.size).toBe(2);
  expect(seen.has(ids[1])).toBe(true);
  expect(seen.has(ids[2])).toBe(true);
});

test('flags round-trip and clear independently', () => {
  const world = new World();
  const dwarf = world.spawn(EntityKind.Dwarf, 0, 0, 0);

  world.addFlag(dwarf, EntityFlags.Burning);
  world.addFlag(dwarf, EntityFlags.Grounded);
  expect(world.state.flags(dwarf) & EntityFlags.Burning).toBeTruthy();

  world.clearFlag(dwarf, EntityFlags.Burning);
  expect(world.state.flags(dwarf) & EntityFlags.Burning).toBeFalsy();
  expect(world.state.flags(dwarf) & EntityFlags.Grounded).toBeTruthy();
});

test('grows past its initial capacity without losing handles', () => {
  const world = new World();
  const ids: EntityId[] = [];
  for (let i = 0; i < 200; i++) ids.push(world.spawn(EntityKind.BreathParticle, i, 0, 0));

  expect(world.state.entityCount()).toBe(200);
  const t = out();
  expect(world.state.transform(ids[0], t)).toBe(true);
  expect(t.x).toBe(0);
  expect(world.state.transform(ids[199], t)).toBe(true);
  expect(t.x).toBe(199);
  expect(world.state.transforms().length).toBeGreaterThanOrEqual(200 * TRANSFORM_STRIDE);
});

test('clear invalidates every outstanding handle', () => {
  const world = new World();
  const ids = [
    world.spawn(EntityKind.Drake, 0, 0, 0),
    world.spawn(EntityKind.Dwarf, 1, 0, 0)
  ];

  world.clear();
  expect(world.state.entityCount()).toBe(0);
  for (const id of ids) expect(world.isLive(id)).toBe(false);

  // Slots are reusable afterwards, and the new handles are distinct.
  const fresh = world.spawn(EntityKind.Dwarf, 7, 0, 7);
  expect(world.isLive(fresh)).toBe(true);
  expect(ids).not.toContain(fresh);
});
