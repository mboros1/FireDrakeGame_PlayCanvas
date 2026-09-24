/**
 * Write the procedural generator's village to a level file.
 *
 *   npm run levels:export
 *
 * Rounds positions to centimetres and angles to tenths of a degree, so the
 * file stays readable and diffs stay small. After export the JSON is the
 * source of truth; edit it (or, soon, the editor's output), not the generator.
 */

import { writeFileSync } from 'node:fs';
import { generateVillage } from '../src/sim/village';
import { propKindName, toLevelFile, validateLevel } from '../src/sim/level';

const cm = (v: number) => Math.round(v * 100) / 100;
const level = generateVillage();
const rounded = validateLevel({
  ...level,
  props: level.props.map(p => ({ kind: propKindName(p.kind), x: cm(p.x), z: cm(p.z), yaw: Math.round(p.yaw * 10) / 10, size: cm(p.size), variant: p.variant })),
  paths: level.paths.map(path => path.map(([x, z]) => [cm(x), cm(z)] as [number, number])),
  pond: level.pond,
  spawns: level.spawns.map(s => ({ x: cm(s.x), z: cm(s.z), yaw: s.yaw })),
  heading: 'In Which Little Kindling Has a Very Bad Day',
  mood: 'afternoon'
});
// One prop per line: diffs of a hand-edited level stay reviewable.
const json = JSON.stringify(toLevelFile(rounded), null, 2)
  .replace(/\{\n\s+"kind": ("[a-z]+"),\n\s+"x": ([-\d.]+),\n\s+"z": ([-\d.]+),\n\s+"yaw": ([-\d.]+),\n\s+"size": ([-\d.]+),\n\s+"variant": (\d+)\n\s+\}/g,
    (_m, k, x, z, y, s, v) => `{ "kind": ${k}, "x": ${x}, "z": ${z}, "yaw": ${y}, "size": ${s}, "variant": ${v} }`)
  .replace(/\[\n\s+([-\d.]+),\n\s+([-\d.]+)\n\s+\]/g, '[$1, $2]');
writeFileSync(`src/levels/${rounded.id}.json`, json + '\n');
console.log(`wrote src/levels/${rounded.id}.json: ${rounded.props.length} props`);
