/**
 * Level definitions: a level is data, not code. This module must never import
 * `playcanvas`.
 *
 * A level file lists every prop (kind, position, facing, size, art variant),
 * the parchment paths and pond painted on the ground, and one spawn point per
 * seat. The client builds the scenery from it, the server builds colliders
 * and flammables from it, and a level editor will write it. Because levels
 * will come from players, {@link validateLevel} treats every file as untrusted
 * and rejects anything malformed with a readable reason.
 */

import { PropKind } from './props';

export const LEVEL_FORMAT = 1;

/** Hard limits: generous for hand-made levels, tight enough to protect a room. */
export const LEVEL_LIMITS = {
  props: 800,
  paths: 24,
  pathPoints: 64,
  spawns: 4,
  /** Half-extent of the playable page, metres. The drake is clamped to it. */
  bounds: 54
} as const;

export type PropPlacement = { kind: PropKind; x: number; z: number; yaw: number; size: number; variant: number };
export type Spawn = { x: number; z: number; yaw: number };

export type LevelDefinition = {
  format: typeof LEVEL_FORMAT;
  /** URL-safe identifier: `little-kindling`. */
  id: string;
  title: string;
  props: PropPlacement[];
  /** Parchment paths, as polylines in metres. Presentation, and props avoid them. */
  paths: [number, number][][];
  /** Pond centre and radius, or null for none. */
  pond: [number, number, number] | null;
  /** One per seat, first is single player. At least one. */
  spawns: Spawn[];
};

export class LevelError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid level: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}`);
  }
}

/**
 * Prop kinds as written in level files. Names, not enum numbers: reordering
 * the enum must never silently turn every saved cottage into a haystack.
 */
export const PROP_KIND_NAMES: Record<string, PropKind> = {
  tree: PropKind.Tree,
  cottage: PropKind.Cottage,
  haystack: PropKind.Haystack,
  stall: PropKind.Stall,
  fence: PropKind.Fence,
  signpost: PropKind.Signpost,
  maypole: PropKind.Maypole
};

export const propKindName = (kind: PropKind) =>
  Object.entries(PROP_KIND_NAMES).find(([, k]) => k === kind)?.[0] ?? 'tree';

/** A level as stored: the same as a {@link LevelDefinition} but with named kinds. */
export type LevelFile = Omit<LevelDefinition, 'props'> & { props: (Omit<PropPlacement, 'kind'> & { kind: string })[] };

/** Convert a validated level back to its file form, for saving. */
export const toLevelFile = (level: LevelDefinition): LevelFile => ({
  ...level,
  props: level.props.map(p => ({ ...p, kind: propKindName(p.kind) }))
});

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Check an untrusted level and return it typed. Throws {@link LevelError}
 * listing every problem found, not just the first, so an editor can show them
 * all at once.
 */
export function validateLevel(raw: unknown): LevelDefinition {
  const problems: string[] = [];
  const level = raw as Partial<LevelFile> | null;
  if (!level || typeof level !== 'object') throw new LevelError(['not an object']);
  const bound = LEVEL_LIMITS.bounds + 6;
  const inBounds = (x: unknown, z: unknown) => finite(x) && finite(z) && Math.abs(x) <= bound && Math.abs(z) <= bound;

  if (level.format !== LEVEL_FORMAT) problems.push(`format must be ${LEVEL_FORMAT}`);
  if (typeof level.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(level.id)) problems.push('id must be 1-48 lower-case letters, digits or hyphens');
  if (typeof level.title !== 'string' || level.title.length === 0 || level.title.length > 80) problems.push('title must be 1-80 characters');

  if (!Array.isArray(level.props)) problems.push('props must be a list');
  else {
    if (level.props.length > LEVEL_LIMITS.props) problems.push(`at most ${LEVEL_LIMITS.props} props`);
    level.props.forEach((p, i) => {
      if (!p || typeof p !== 'object') return problems.push(`prop ${i}: not an object`);
      if (!(typeof p.kind === 'string' && Object.hasOwn(PROP_KIND_NAMES, p.kind))) problems.push(`prop ${i}: unknown kind ${String(p.kind)}`);
      if (!inBounds(p.x, p.z)) problems.push(`prop ${i}: position off the page`);
      if (!finite(p.yaw)) problems.push(`prop ${i}: yaw must be a number`);
      if (!finite(p.size) || p.size < .3 || p.size > 3) problems.push(`prop ${i}: size must be 0.3-3`);
      if (!Number.isInteger(p.variant) || p.variant < 0 || p.variant > 1e6) problems.push(`prop ${i}: variant must be a whole number`);
    });
  }

  if (!Array.isArray(level.paths)) problems.push('paths must be a list');
  else {
    if (level.paths.length > LEVEL_LIMITS.paths) problems.push(`at most ${LEVEL_LIMITS.paths} paths`);
    level.paths.forEach((path, i) => {
      if (!Array.isArray(path) || path.length < 2 || path.length > LEVEL_LIMITS.pathPoints) return problems.push(`path ${i}: needs 2-${LEVEL_LIMITS.pathPoints} points`);
      if (!path.every(pt => Array.isArray(pt) && inBounds(pt[0], pt[1]))) problems.push(`path ${i}: point off the page`);
    });
  }

  if (level.pond !== null) {
    const pond = level.pond;
    if (!Array.isArray(pond) || !inBounds(pond[0], pond[1]) || !finite(pond[2]) || pond[2] <= 0 || pond[2] > 20) problems.push('pond must be [x, z, radius] with radius 0-20, or null');
  }

  if (!Array.isArray(level.spawns) || level.spawns.length === 0 || level.spawns.length > LEVEL_LIMITS.spawns) problems.push(`spawns must list 1-${LEVEL_LIMITS.spawns} points`);
  else level.spawns.forEach((s, i) => {
    if (!s || !inBounds(s.x, s.z) || !finite(s.yaw)) problems.push(`spawn ${i}: needs x, z and yaw on the page`);
  });

  if (problems.length > 0) throw new LevelError(problems);
  const file = level as LevelFile;
  return { ...file, props: file.props.map(p => ({ ...p, kind: PROP_KIND_NAMES[p.kind] })) };
}

/** Where seat `seat` enters. Seats beyond the listed spawns reuse them, spread out. */
export const spawnFor = (level: LevelDefinition, seat: number): Spawn => {
  const spawns = level.spawns;
  const base = spawns[seat % spawns.length];
  const lap = Math.floor(seat / spawns.length);
  return lap === 0 ? base : { x: base.x + lap * 3, z: base.z + lap * 1.5, yaw: base.yaw };
};
