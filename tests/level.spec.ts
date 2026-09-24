import { expect, test } from '@playwright/test';
import { LEVEL_LIMITS, LevelError, spawnFor, toLevelFile, validateLevel } from '../src/sim/level';
import { getLevel, levelIds } from '../src/sim/levels';
import { generateVillage } from '../src/sim/village';
import { PropKind } from '../src/sim/props';

const problemsOf = (raw: unknown) => {
  try {
    validateLevel(raw);
    return [];
  } catch (error) {
    return error instanceof LevelError ? error.problems : [String(error)];
  }
};

const base = () => JSON.parse(JSON.stringify(toLevelFile(getLevel())));

test('every built-in level validates and has a village worth burning', () => {
  for (const id of levelIds()) {
    const level = getLevel(id);
    expect(level.id).toBe(id);
    expect(level.props.length).toBeGreaterThan(50);
    expect(level.props.some(p => p.kind === PropKind.Cottage)).toBe(true);
    expect(level.spawns.length).toBeGreaterThanOrEqual(1);
  }
});

test('an unknown level id falls back to the default level', () => {
  expect(getLevel('no-such-level').id).toBe('little-kindling');
});

test('a level survives a round trip through its file form', () => {
  const level = getLevel();
  expect(validateLevel(JSON.parse(JSON.stringify(toLevelFile(level))))).toEqual(level);
});

test('the generator still produces a valid level', () => {
  expect(() => validateLevel(toLevelFile(generateVillage()))).not.toThrow();
});

test('hostile or broken levels are rejected with every problem named', () => {
  expect(problemsOf(null)).toEqual(['not an object']);
  expect(problemsOf('a string')).toEqual(['not an object']);

  const bad = base();
  bad.format = 99;
  bad.id = '../../etc/passwd';
  bad.props[0].kind = 'dragon';
  bad.props[1].kind = 'constructor';
  bad.props[2].x = 1e9;
  bad.props[3].size = 0;
  bad.props[4].variant = 1.5;
  bad.spawns = [];
  const problems = problemsOf(bad);
  expect(problems).toEqual(expect.arrayContaining([
    'format must be 1',
    'id must be 1-48 lower-case letters, digits or hyphens',
    'prop 0: unknown kind dragon',
    'prop 1: unknown kind constructor',
    'prop 2: position off the page',
    'prop 3: size must be 0.3-3',
    'prop 4: variant must be a whole number',
    'spawns must list 1-4 points'
  ]));
});

test('levels are capped so a room cannot be flooded with props', () => {
  const flood = base();
  flood.props = Array.from({ length: LEVEL_LIMITS.props + 1 }, () => ({ ...flood.props[0] }));
  expect(problemsOf(flood)).toContain(`at most ${LEVEL_LIMITS.props} props`);
});

test('seats beyond the listed spawns still get distinct spots', () => {
  const level = { ...getLevel(), spawns: [{ x: 0, z: 0, yaw: 0 }] };
  const a = spawnFor(level, 0);
  const b = spawnFor(level, 1);
  expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2);
});

test('chapter details are optional, and validated when present', () => {
  const plain = base();
  expect(problemsOf(plain)).toEqual([]);

  const written = base();
  written.mood = 'moonlit';
  written.heading = 'In Which the Moon Regrets Everything';
  written.narration = { opening: 'That night, all was quiet.', ending: 'And so to bed.' };
  written.deeds = [{ template: 'burn-haystacks', count: 3 }, { template: 'chain', count: 5, title: 'Keep it going' }];
  expect(problemsOf(written)).toEqual([]);
  expect(validateLevel(written).mood).toBe('moonlit');

  const bad = base();
  bad.mood = 'eclipse';
  bad.heading = 'x'.repeat(200);
  bad.narration = { opening: 'y'.repeat(500) };
  bad.deeds = [{ template: 'summon-bees', count: 1 }, { template: 'chain', count: 0 }, { template: 'ghosts', count: 2, title: 'z'.repeat(60) }];
  expect(problemsOf(bad)).toEqual(expect.arrayContaining([
    'mood must be one of afternoon, moonlit, snow',
    'heading must be at most 100 characters',
    'narration lines must be at most 240 characters',
    'deed 0: unknown goal summon-bees',
    'deed 1: count must be 1-500',
    'deed 2: title must be at most 48 characters'
  ]));
});
