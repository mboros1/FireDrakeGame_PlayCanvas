import { expect, test } from '@playwright/test';
import { World } from '../src/sim/world';
import { Rng } from '../src/sim/random';
import { DrakeSim } from '../src/sim/drake';
import { DwarfSim } from '../src/sim/dwarf';
import { PropKind, PropSim, PropState } from '../src/sim/props';
import { Rampage, type RampageEvent } from '../src/sim/rampage';
import { buildVillageLayout } from '../src/sim/village';
import { NO_INPUT, type Input, type Transform } from '../src/sim/types';

const TICK = 1 / 60;

/** A bare rampage — no village — with hand-placed dwarves and props. */
const setup = (seed = 1) => {
  const world = new World();
  const rng = new Rng(seed);
  const drake = new DrakeSim(world, 0, 0, 0);
  const rampage = new Rampage(world, rng, drake);
  const events: RampageEvent[] = [];
  const run = (seconds: number, input: Input = NO_INPUT) => {
    for (let f = 0; f < Math.round(seconds / TICK); f++) {
      rampage.tick(TICK, input);
      rampage.drainEvents(events);
    }
  };
  const addDwarf = (x: number, z: number) => {
    const dwarf = new DwarfSim(world, rng, x, z);
    rampage.dwarves.push(dwarf);
    return dwarf;
  };
  const addProp = (kind: PropKind, x: number, z: number) => {
    const prop = new PropSim(world, kind, x, z);
    rampage.props.push(prop);
    return prop;
  };
  return { world, drake, rampage, events, run, addDwarf, addProp };
};

const input = (overrides: Partial<Input>): Input => ({ ...NO_INPUT, ...overrides });

test('breath ignites a dwarf in front of the drake and not one behind it', () => {
  const { rampage, run, addDwarf, events } = setup();
  const ahead = addDwarf(0, -5);
  const behind = addDwarf(0, 6);
  // The front dwarf is inside the flee radius and will run; breathe at once.
  run(.1, input({ breathing: true }));

  expect(ahead.burning).toBe(true);
  expect(behind.burning).toBe(false);
  expect(events.some(e => e.type === 'dwarfIgnited')).toBe(true);
  expect(rampage.score).toBeGreaterThan(0);
});

test('breath sets a haystack alight and it burns down to charred', () => {
  const { run, addProp, events } = setup();
  const hay = addProp(PropKind.Haystack, 0, -6);
  run(.1, input({ breathing: true }));
  expect(hay.state).toBe(PropState.Burning);

  run(5);
  expect(hay.state).toBe(PropState.Charred);
  expect(events.some(e => e.type === 'propCharred')).toBe(true);
});

test('fire spreads from one haystack to its neighbour', () => {
  const { world, run, addProp } = setup();
  const lit = addProp(PropKind.Haystack, 30, 30);
  const neighbour = addProp(PropKind.Haystack, 32.5, 30);
  lit.ignite(world);
  run(4);
  expect(neighbour.state).not.toBe(PropState.Intact);
});

test('a charge launches a dwarf into the air and it lands stunned', () => {
  const { world, drake, run, addDwarf, events } = setup();
  // Build up to a charge first, then put a dwarf in the way.
  run(1.5, input({ forward: 1, charging: true }));
  const at: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
  world.state.transform(drake.id, at);
  const dwarf = addDwarf(at.x, at.z - 2.2);

  run(.15, input({ forward: 1, charging: true }));
  expect(events.some(e => e.type === 'dwarfLaunched')).toBe(true);
  expect(dwarf.airborne).toBe(true);

  let peak = 0;
  for (let i = 0; i < 90; i++) {
    run(TICK);
    world.state.transform(dwarf.id, at);
    peak = Math.max(peak, at.y);
  }
  expect(peak).toBeGreaterThan(1.5);
  run(3);
  expect(dwarf.airborne).toBe(false);
  expect(events.some(e => e.type === 'dwarfLanded')).toBe(true);
});

test('walking into a cottage stops the drake; charging into it flattens it', () => {
  const walk = setup();
  const solid = walk.addProp(PropKind.Cottage, 0, -8);
  walk.run(3, input({ forward: 1 }));
  const at: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
  walk.world.state.transform(walk.drake.id, at);
  expect(solid.state).toBe(PropState.Intact);
  // Held outside the cottage's footprint rather than walking through it.
  expect(at.z).toBeGreaterThan(-8 + solid.radius);

  const charge = setup();
  const flat = charge.addProp(PropKind.Cottage, 0, -22);
  charge.run(3, input({ forward: 1, charging: true }));
  expect(flat.state).toBe(PropState.Flattened);
  expect(charge.events.some(e => e.type === 'propFlattened')).toBe(true);
});

test('the combo multiplier rewards chaining and lapses when idle', () => {
  const { world, rampage, run, addProp } = setup();
  for (let i = 0; i < 4; i++) addProp(PropKind.Fence, -1.5 + i, -4);
  run(.4, input({ breathing: true }));
  expect(rampage.combo).toBeGreaterThanOrEqual(3);
  const chained = rampage.score;
  expect(chained).toBeGreaterThan(4 * 3);
  run(3);
  expect(rampage.combo).toBe(0);
  void world;
});

test('the village is deterministic: same seed and inputs, same outcome', () => {
  const play = () => {
    const world = new World();
    const rng = new Rng(99);
    const layout = buildVillageLayout();
    const drake = new DrakeSim(world, layout.drakeStart.x, layout.drakeStart.z, 0);
    const rampage = new Rampage(world, rng, drake, layout);
    const moves: Input[] = [
      input({ forward: 1 }),
      input({ forward: 1, breathing: true }),
      input({ forward: 1, charging: true, cameraYaw: 30 }),
      input({ right: 1, breathing: true, cameraYaw: -20 })
    ];
    for (let f = 0; f < 60 * 12; f++) rampage.tick(TICK, moves[Math.floor(f / 180) % moves.length]);
    const at: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
    world.state.transform(drake.id, at);
    return { score: rampage.score, dwarves: rampage.livingDwarves, x: at.x, z: at.z, burning: rampage.props.filter(p => p.state !== PropState.Intact).length };
  };
  const a = play();
  const b = play();
  expect(a).toEqual(b);
  expect(a.score).toBeGreaterThan(0);
});

test('the village layout keeps the drake start and the pond clear', () => {
  const layout = buildVillageLayout();
  const { drakeStart, pond } = layout;
  for (const prop of layout.props) {
    expect(Math.hypot(prop.x - drakeStart.x, prop.z - drakeStart.z)).toBeGreaterThan(5);
    expect(Math.hypot(prop.x - pond[0], prop.z - pond[1])).toBeGreaterThan(pond[2]);
  }
  expect(layout.props.filter(p => p.kind === PropKind.Cottage).length).toBeGreaterThanOrEqual(6);
});
