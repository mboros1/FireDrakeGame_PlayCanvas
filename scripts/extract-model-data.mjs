/**
 * Extract rest-pose measurements from a character GLB into a generated module.
 *
 *   node scripts/extract-model-data.mjs
 *
 * Why this exists: the drake's ground offset, its recentring, and the breath
 * socket are all *derived from the asset*. Hand-transcribing them into source
 * means they silently desync the moment the model or the target scale changes —
 * which is exactly the bug class that put the drake's fire origin inside its
 * belly for the whole life of the prototype.
 *
 * The output is committed. `public/assets/` is excluded from version control,
 * so a fresh checkout has no GLB; keeping the derived numbers in the tree keeps
 * the build self-contained without carrying ~155 MB of binaries.
 *
 * Sockets follow a naming convention rather than being listed by hand. A socket
 * may resolve to several bones (a symmetric left/right pair), in which case
 * their positions are averaged.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'public/assets/wyvern/wyvern.glb');
const OUTPUT = join(root, 'src/generated/wyvern-model.ts');

/** Socket name → bone name patterns whose rest positions get averaged. */
const SOCKETS = {
  /** Snout tip. Fire breath origin — the equivalent of Unreal's MouthSocket. */
  mouth: ['mouth7_L_001_047', 'mouth7_R_001_066'],
  head: ['head_021'],
  jaw: ['jaw_022']
};

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const mul = (a, b) => {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
};

const localMatrix = (node) => {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1
  ];
};

const transformPoint = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14]
];

export function extract(glbPath) {
  const buf = readFileSync(glbPath);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${glbPath} is not a GLB`);
  const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const nodePositions = new Map();

  const visit = (index, parent) => {
    const node = gltf.nodes[index];
    const world = mul(parent, localMatrix(node));
    if (node.name) nodePositions.set(node.name, [world[12], world[13], world[14]]);

    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION];
        if (!accessor?.min || !accessor?.max) continue;
        // All eight corners: a rotated node's AABB is not its min/max.
        for (let corner = 0; corner < 8; corner++) {
          const point = transformPoint(world, [
            corner & 1 ? accessor.max[0] : accessor.min[0],
            corner & 2 ? accessor.max[1] : accessor.min[1],
            corner & 4 ? accessor.max[2] : accessor.min[2]
          ]);
          for (let axis = 0; axis < 3; axis++) {
            lo[axis] = Math.min(lo[axis], point[axis]);
            hi[axis] = Math.max(hi[axis], point[axis]);
          }
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const node of gltf.scenes[gltf.scene ?? 0].nodes) visit(node, IDENTITY);

  const sockets = {};
  const missing = [];
  for (const [name, bones] of Object.entries(SOCKETS)) {
    const found = bones.map(b => nodePositions.get(b)).filter(Boolean);
    if (found.length !== bones.length) {
      missing.push(`${name} (want ${bones.join(', ')})`);
      continue;
    }
    sockets[name] = [0, 1, 2].map(
      axis => found.reduce((sum, p) => sum + p[axis], 0) / found.length
    );
  }
  if (missing.length) throw new Error(`sockets not found in ${glbPath}: ${missing.join('; ')}`);

  return {
    bounds: { min: lo, max: hi, size: hi.map((h, i) => h - lo[i]) },
    /** Distance from the model origin down to the lowest vertex. */
    footDrop: -lo[1],
    /** Depth centre of the bounds, for recentring after the facing flip. */
    zCentre: (lo[2] + hi[2]) / 2,
    sockets,
    boneNames: Object.fromEntries(
      Object.entries(SOCKETS).map(([name, bones]) => [name, bones])
    )
  };
}

const round = (n) => Number(n.toFixed(4));
const vec = (v) => `[${v.map(round).join(', ')}]`;

function render(data, sourceName) {
  return `/**
 * GENERATED — do not edit. Run \`npm run extract:model\` to regenerate.
 *
 * Rest-pose measurements extracted from \`${sourceName}\` by
 * \`scripts/extract-model-data.mjs\`. All values are in raw GLB units, in model
 * space, before the runtime scale/rotation/offset in \`src/tuning.ts\`.
 *
 * Committed deliberately: \`public/assets/\` is excluded from version control,
 * so the build must not depend on the GLB being present.
 */

export const WYVERN_MODEL = {
  bounds: {
    min: ${vec(data.bounds.min)},
    max: ${vec(data.bounds.max)},
    size: ${vec(data.bounds.size)}
  },
  /** Model origin down to the lowest vertex — the drake's ground offset. */
  footDrop: ${round(data.footDrop)},
  /** Depth centre, for recentring after the 180-degree facing flip. */
  zCentre: ${round(data.zCentre)},
  /** Standing height. */
  height: ${round(data.bounds.size[1])},
  /**
   * Attachment points, averaged over their source bones. The equivalent of
   * Unreal's named sockets — see \`SOCKETS\` in the extraction script.
   */
  sockets: {
${Object.entries(data.sockets)
  .map(([name, position]) => `    ${name}: ${vec(position)}`)
  .join(',\n')}
  },
  /** Bone names each socket was averaged from, for the view to look up live. */
  socketBones: {
${Object.entries(data.boneNames)
  .map(([name, bones]) => `    ${name}: [${bones.map(b => `'${b}'`).join(', ')}]`)
  .join(',\n')}
  }
} as const;
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(SOURCE)) {
    console.error(`Source model not found: ${SOURCE}`);
    console.error('Runtime assets are excluded from version control; restore them first.');
    process.exit(1);
  }
  const data = extract(SOURCE);
  writeFileSync(OUTPUT, render(data, 'public/assets/wyvern/wyvern.glb'));
  console.log(`Wrote ${OUTPUT}`);
  console.log(`  size     ${data.bounds.size.map(n => n.toFixed(1)).join(' x ')}`);
  console.log(`  footDrop ${data.footDrop.toFixed(2)}   zCentre ${data.zCentre.toFixed(2)}`);
  for (const [name, position] of Object.entries(data.sockets)) {
    console.log(`  socket ${name.padEnd(6)} ${position.map(n => n.toFixed(1)).join(', ')}`);
  }
}
