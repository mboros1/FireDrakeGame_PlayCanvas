/**
 * Level layout for chapter two: the village of Little Kindling. This module
 * must never import `playcanvas`.
 *
 * Layout is simulation data, not presentation — the server needs every
 * collider and every flammable thing in the same place the client draws them.
 * It is generated from a seed rather than hand-placed so the whole village is
 * a few dozen lines, and the same seed always yields the same village.
 */

import { Rng } from './random';
import { PropKind } from './props';

export type PropPlacement = { kind: PropKind; x: number; z: number; yaw: number; size: number; variant: number };

export type VillageLayout = {
  props: PropPlacement[];
  /** Parchment paths, as polylines in metres. Presentation only, but shared so props avoid them. */
  paths: [number, number][][];
  /** Pond centre and radius. */
  pond: [number, number, number];
  drakeStart: { x: number; z: number; yaw: number };
};

const facing = (x: number, z: number, towardX: number, towardZ: number) =>
  Math.atan2(towardX - x, towardZ - z) * (180 / Math.PI);

const distanceToSegment = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
};

export const buildVillageLayout = (seed = 0x5eed): VillageLayout => {
  const rng = new Rng(seed);
  const props: PropPlacement[] = [];
  const pond: [number, number, number] = [26, -24, 6.5];
  const drakeStart = { x: 0, z: 38, yaw: 0 };

  const paths: [number, number][][] = [
    [[0, 52], [2, 38], [-1, 24], [0, 10], [0, 0]],
    [[0, 0], [-12, -6], [-26, -8], [-40, -18], [-52, -20]],
    [[0, 0], [10, -10], [16, -24], [14, -40], [18, -52]],
    [[0, 0], [14, 4], [30, 10], [44, 8], [54, 12]]
  ];

  const clearOf = (x: number, z: number, radius: number) => {
    if (Math.hypot(x - pond[0], z - pond[1]) < pond[2] + radius + 1) return false;
    if (Math.hypot(x - drakeStart.x, z - drakeStart.z) < 7 + radius) return false;
    for (const path of paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const [ax, az] = path[i];
        const [bx, bz] = path[i + 1];
        if (distanceToSegment(x, z, ax, az, bx, bz) < 2.2 + radius) return false;
      }
    }
    for (const prop of props) {
      const r = prop.kind === PropKind.Cottage ? 4 : prop.kind === PropKind.Tree ? 1.6 : 1.8;
      if (Math.hypot(x - prop.x, z - prop.z) < r + radius) return false;
    }
    return true;
  };

  // The maypole, and the reason the village is having a festival at all.
  props.push({ kind: PropKind.Maypole, x: 0, z: 0, yaw: 0, size: 1, variant: 0 });

  // Cottages ring the green with their doors turned to the maypole.
  const cottageCount = 9;
  for (let i = 0; i < cottageCount; i++) {
    const angle = (i / cottageCount) * Math.PI * 2 + rng.spread(.12) + .3;
    const radius = 16 + rng.range(0, 7);
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    if (!clearOf(x, z, 3)) continue;
    props.push({ kind: PropKind.Cottage, x, z, yaw: facing(x, z, 0, 0), size: rng.range(.9, 1.15), variant: i });
  }

  // Market stalls on the green.
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + .8;
    const x = Math.sin(angle) * 7.5;
    const z = Math.cos(angle) * 7.5;
    if (!clearOf(x, z, 1.2)) continue;
    props.push({ kind: PropKind.Stall, x, z, yaw: facing(x, z, 0, 0), size: 1, variant: i });
  }

  // Haystacks gather in the fields, generally in dangerously dry clusters.
  for (const [cx, cz] of [[-30, 20], [30, 30], [-28, -34], [38, -6]] as const) {
    for (let i = 0; i < 5; i++) {
      const x = cx + rng.spread(6);
      const z = cz + rng.spread(6);
      if (!clearOf(x, z, 1)) continue;
      props.push({ kind: PropKind.Haystack, x, z, yaw: rng.range(0, 360), size: rng.range(.85, 1.2), variant: i });
    }
  }

  // A picket fence around one field, in panels, each of which will burn.
  for (let i = 0; i < 8; i++) {
    const x = -38 + i * 3.4;
    const z = 12;
    if (!clearOf(x, z, .4)) continue;
    props.push({ kind: PropKind.Fence, x, z, yaw: 0, size: 1, variant: i });
  }
  for (let i = 0; i < 6; i++) {
    const x = -38.5;
    const z = 13.7 + i * 3.4;
    if (!clearOf(x, z, .4)) continue;
    props.push({ kind: PropKind.Fence, x, z, yaw: 90, size: 1, variant: i });
  }

  props.push({ kind: PropKind.Signpost, x: 4.5, z: 30, yaw: -20, size: 1, variant: 0 });

  // Woods: denser towards the edge of the page, sparse around the green.
  let attempts = 0;
  let trees = 0;
  while (trees < 95 && attempts < 3000) {
    attempts++;
    const x = rng.spread(52);
    const z = rng.spread(52);
    const fromCentre = Math.hypot(x, z);
    if (fromCentre < 24 && rng.next() < .85) continue;
    if (!clearOf(x, z, .8)) continue;
    props.push({ kind: PropKind.Tree, x, z, yaw: rng.range(0, 360), size: rng.range(.8, 1.35), variant: Math.floor(rng.next() * 1000) });
    trees++;
  }

  return { props, paths, pond, drakeStart };
};
