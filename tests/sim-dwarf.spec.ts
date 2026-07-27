import { expect, test } from '@playwright/test';
import { World } from '../src/sim/world';
import { Rng } from '../src/sim/random';
import { BURN_DURATION, DwarfSim } from '../src/sim/dwarf';
import { EntityFlags, type Transform } from '../src/sim/types';

const TICK = 1 / 60;

const setup = (seed = 1, x = 0, z = 0) => {
  const world = new World();
  const dwarf = new DwarfSim(world, new Rng(seed), x, z);
  const at: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
  const read = () => {
    world.state.transform(dwarf.id, at);
    return at;
  };
  const run = (seconds: number) => {
    for (let f = 0; f < Math.round(seconds / TICK); f++) dwarf.update(world, TICK);
  };
  return { world, dwarf, read, run };
};

test('wanders away from where it spawned', () => {
  const { read, run } = setup();
  run(2);

  const at = read();
  expect(Math.hypot(at.x, at.z)).toBeGreaterThan(1);
  expect(at.y).toBe(0);
});

test('faces the direction it is walking', () => {
  const { read, run } = setup();
  run(0.5);

  const before = { x: read().x, z: read().z };
  run(0.25);
  const after = read();

  // Forward is -Z, matching the drake's convention.
  const travelYaw = Math.atan2(-(after.x - before.x), -(after.z - before.z)) * (180 / Math.PI);
  expect(Math.abs(((after.yaw - travelYaw + 540) % 360) - 180)).toBeLessThan(5);
});

test('ignites, panics, and burns out', () => {
  const { world, dwarf, run } = setup();

  expect(dwarf.burning).toBe(false);
  dwarf.ignite(world);
  expect(dwarf.burning).toBe(true);
  expect(world.state.flags(dwarf.id) & EntityFlags.Burning).toBeTruthy();
  expect(dwarf.burnRemainingSeconds).toBeCloseTo(BURN_DURATION, 3);

  run(BURN_DURATION - 0.5);
  expect(dwarf.dead).toBe(false);

  run(1);
  expect(dwarf.dead).toBe(true);
  // The simulated entity is gone, not merely flagged.
  expect(world.isLive(dwarf.id)).toBe(false);
  expect(world.state.entityCount()).toBe(0);
});

test('runs faster while burning', () => {
  const distanceOver = (ignite: boolean) => {
    const { world, dwarf, read, run } = setup(7);
    if (ignite) dwarf.ignite(world);
    const start = { x: read().x, z: read().z };
    run(1);
    const end = read();
    return Math.hypot(end.x - start.x, end.z - start.z);
  };

  expect(distanceOver(true)).toBeGreaterThan(distanceOver(false));
});

test('igniting an already burning dwarf does not restart the timer', () => {
  const { world, dwarf, run } = setup();
  dwarf.ignite(world);
  run(2);
  const remaining = dwarf.burnRemainingSeconds;

  dwarf.ignite(world);
  expect(dwarf.burnRemainingSeconds).toBeCloseTo(remaining, 5);
});

test('a dead dwarf stops simulating', () => {
  const { world, dwarf, run } = setup();
  dwarf.ignite(world);
  run(BURN_DURATION + 0.5);
  expect(dwarf.dead).toBe(true);

  // Further ticks are inert rather than throwing on a stale handle.
  run(1);
  expect(dwarf.dead).toBe(true);
  dwarf.ignite(world);
  expect(dwarf.burning).toBe(false);
});

test('the same seed produces the same wander', () => {
  // Determinism is the property the whole architecture rests on, so the
  // simulation must never reach for Math.random().
  const a = setup(1234);
  const b = setup(1234);
  a.run(3);
  b.run(3);

  expect(a.read().x).toBeCloseTo(b.read().x, 10);
  expect(a.read().z).toBeCloseTo(b.read().z, 10);
});

test('different seeds produce different wanders', () => {
  const a = setup(1);
  const b = setup(2);
  a.run(3);
  b.run(3);

  expect(Math.hypot(a.read().x - b.read().x, a.read().z - b.read().z)).toBeGreaterThan(0.5);
});
