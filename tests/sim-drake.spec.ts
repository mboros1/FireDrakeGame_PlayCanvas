import { expect, test } from '@playwright/test';
import { World } from '../src/sim/world';
import { DrakeSim } from '../src/sim/drake';
import { NO_INPUT, type Input, type Transform } from '../src/sim/types';

const TICK = 1 / 60;

const input = (over: Partial<Input> = {}): Input => ({ ...NO_INPUT, ...over });

const setup = (x = 0, z = 0, yaw = 0) => {
  const world = new World();
  const drake = new DrakeSim(world, x, z, yaw);
  const at: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
  const read = () => {
    world.state.transform(drake.id, at);
    return at;
  };
  const run = (frames: number, i: Input) => {
    for (let f = 0; f < frames; f++) drake.update(world, TICK, i);
  };
  return { world, drake, read, run };
};

test('walks forward along -Z when the camera faces default', () => {
  const { read, run } = setup();
  run(30, input({ forward: 1 }));

  const at = read();
  expect(at.z).toBeLessThan(-1);
  expect(Math.abs(at.x)).toBeLessThan(0.001);
  expect(at.y).toBeCloseTo(0.1);
});

test('movement is camera-relative, not drake-relative', () => {
  // Camera yawed 90 degrees: "forward" is now -X in world space.
  const { read, run } = setup();
  run(120, input({ forward: 1, cameraYaw: 90 }));

  const at = read();
  expect(at.yaw).toBeCloseTo(90, 0);
  // Travel is predominantly -X. Not purely: the drake steers toward the
  // desired heading while moving along its current facing, so it leaves a
  // curved path rather than turning on the spot.
  expect(at.x).toBeLessThan(-2);
  expect(Math.abs(at.x)).toBeGreaterThan(Math.abs(at.z));
});

test('turns to face the direction of travel', () => {
  const { read, run } = setup();
  // Turning is an exponential approach, not a snap, so it needs a moment.
  run(60, input({ right: 1 }));
  // Strafing right with the camera at rest means heading +X, which is yaw -90.
  expect(read().yaw).toBeCloseTo(-90, 0);
});

test('steers rather than pivoting on the spot', () => {
  const { read, run } = setup();
  // Demanded heading is +X (yaw -90) but the drake starts facing -Z, so its
  // first strides still carry it forward before the turn takes effect.
  run(10, input({ right: 1 }));

  const at = read();
  expect(at.z).toBeLessThan(0);
  expect(at.yaw).toBeGreaterThan(-90);
  expect(at.yaw).toBeLessThan(0);
});

test('charging covers more ground than walking', () => {
  const walk = setup();
  walk.run(60, input({ forward: 1 }));

  const charge = setup();
  charge.run(60, input({ forward: 1, charging: true }));

  expect(Math.abs(charge.read().z)).toBeGreaterThan(Math.abs(walk.read().z));
});

test('accelerates rather than starting at full speed', () => {
  const { drake, run } = setup();
  run(1, input({ forward: 1 }));
  const afterOneTick = drake.speed;

  run(59, input({ forward: 1 }));
  expect(drake.speed).toBeGreaterThan(afterOneTick);
});

test('coasts to a stop when input is released', () => {
  const { drake, run } = setup();
  run(60, input({ forward: 1 }));
  expect(drake.speed).toBeGreaterThan(1);

  run(120, NO_INPUT);
  expect(drake.speed).toBeLessThan(0.1);
});

test('stays inside the level bounds', () => {
  const { drake, read, run } = setup(0, -50);
  run(300, input({ forward: 1, charging: true }));

  const at = read();
  expect(at.z).toBeGreaterThanOrEqual(-drake.boundsXZ);
  expect(at.z).toBeCloseTo(-drake.boundsXZ, 1);
});

test('rate-limits breath rather than emitting every tick', () => {
  const { drake, world } = setup();
  const breathing = input({ breathing: true });

  drake.update(world, TICK, breathing);
  expect(drake.breathed).toBe(true);

  // A 0.055 s interval against a 1/60 s tick leaves three silent ticks.
  for (let f = 0; f < 3; f++) {
    drake.update(world, TICK, breathing);
    expect(drake.breathed).toBe(false);
  }

  drake.update(world, TICK, breathing);
  expect(drake.breathed).toBe(true);
});

test('does not breathe without the input', () => {
  const { drake, world } = setup();
  for (let f = 0; f < 30; f++) {
    drake.update(world, TICK, NO_INPUT);
    expect(drake.breathed).toBe(false);
  }
});

test('place moves the drake and kills its momentum', () => {
  const { drake, world, read, run } = setup();
  run(60, input({ forward: 1, charging: true }));
  expect(drake.speed).toBeGreaterThan(1);

  drake.place(world, 12, -8, 180);
  const at = read();
  expect(at.x).toBe(12);
  expect(at.z).toBe(-8);
  expect(at.yaw).toBe(180);
  expect(drake.speed).toBe(0);
});
