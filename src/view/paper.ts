/**
 * Paper-theatre rendering primitives.
 *
 * The whole world outside the drake is cut paper: every texture is drawn at
 * startup with Canvas2D, so there are no art assets to ship and no pipeline to
 * maintain. This module owns the three pieces that make that work:
 *
 * - **Sprite textures** whose alpha channel does double duty. Outside the
 *   silhouette alpha is 0. Inside it encodes a burn order — a smooth noise
 *   biased so paper burns from the bottom up — in the range 0.5..1. Raising a
 *   material's `alphaTest` from 0.5 towards 1 then eats the cutout away in
 *   ragged holes, which is how paper burns without a custom shader.
 * - **Shared meshes**: a unit quad pivoted at its bottom centre, and the
 *   crossed pair of quads used for trees and props.
 * - **Materials** for cutouts, folded paper and unlit backdrops.
 *
 * View-only. Uses `Math.random()` freely — nothing here is simulated.
 */

import * as pc from 'playcanvas';

let device: pc.GraphicsDevice;

export const initPaper = (graphicsDevice: pc.GraphicsDevice) => {
  device = graphicsDevice;
};

// ── Deterministic art noise ────────────────────────────────────────────────

/** Small seeded generator so the same art is drawn on every load. */
export const artRng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hash2 = (x: number, y: number, seed: number) => {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Value noise in [0, 1], smooth at `scale` pixels per cell. */
export const valueNoise = (x: number, y: number, scale: number, seed = 7) => {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};

const fbm = (x: number, y: number, scale: number, seed: number) =>
  valueNoise(x, y, scale, seed) * .55 +
  valueNoise(x, y, scale / 2.3, seed + 1) * .3 +
  valueNoise(x, y, scale / 5.1, seed + 2) * .15;

// ── Canvas helpers ─────────────────────────────────────────────────────────

export const makeCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return { canvas, ctx };
};

/**
 * Wobbly polygon: the irregular edge of something cut with scissors. Draws
 * `points` as a closed path with each segment subdivided and jittered.
 */
export const scissorPath = (
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  jitter: number,
  rand: () => number,
  step = 14
) => {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.round(length / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t + (rand() - .5) * jitter;
      const y = ay + (by - ay) * t + (rand() - .5) * jitter;
      if (i === 0 && s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
};

/** Circle-ish blob with a scissor edge. */
export const blobPath = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rand: () => number,
  lumps = 0,
  lumpSize = 0,
  jitter = 3
) => {
  const points: [number, number][] = [];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const lump = lumps ? Math.pow(Math.abs(Math.sin(a * lumps / 2)), .6) * lumpSize : 0;
    points.push([cx + Math.cos(a) * (rx + lump), cy + Math.sin(a) * (ry + lump)]);
  }
  scissorPath(ctx, points, jitter, rand, 9);
};

/** Multiply a fibrous paper grain over everything already drawn. */
export const grainOver = (ctx: CanvasRenderingContext2D, width: number, height: number, strength = .16, seed = 3) => {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      const fibre = valueNoise(x * 3, y * .5, 9, seed) * .5 + valueNoise(x, y, 3, seed + 9) * .5;
      const k = 1 - strength * .5 + (fibre - .5) * strength;
      data[i] *= k;
      data[i + 1] *= k;
      data[i + 2] *= k;
    }
  }
  ctx.putImageData(image, 0, 0);
};

// ── Textures ───────────────────────────────────────────────────────────────

type TextureOptions = {
  repeat?: boolean;
  /** Encode a bottom-up burn order into alpha. See the module comment. */
  burnable?: boolean;
  /** Keep canvas alpha as-is instead of hard-thresholding it. */
  softAlpha?: boolean;
  linear?: boolean;
  seed?: number;
};

/**
 * Upload a canvas as a texture, taking control of the alpha channel.
 *
 * Pixels are copied through a raw buffer rather than `setSource(canvas)` so
 * transparent texels can carry their neighbour's colour. Without that, mip
 * filtering pulls black in from the transparent surround and every cutout
 * grows a dark halo at a distance.
 */
export const canvasTexture = (canvas: HTMLCanvasElement, options: TextureOptions = {}) => {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const source = ctx.getImageData(0, 0, width, height).data;
  // Flip rows: canvas row 0 is the top of the drawing, texture row 0 is v=0,
  // the bottom. After this, "bottom of the canvas" means "bottom of the quad".
  const data = new Uint8Array(source.length);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    data.set(source.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  }

  if (!options.softAlpha) {
    const seed = options.seed ?? 11;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 110) {
          data[i + 3] = 0;
          continue;
        }
        if (options.burnable) {
          // 0 at the bottom edge, 1 at the top, perturbed by blotchy noise.
          // Rows are already flipped, so y counts up from the bottom.
          const up = y / height;
          const order = fbm(x, y, width / 5, seed) * .62 + up * .38;
          data[i + 3] = 132 + Math.round(Math.min(1, Math.max(0, order)) * 122);
        } else {
          data[i + 3] = 255;
        }
      }
    }
    bleedIntoTransparent(data, width, height);
  }

  const texture = new pc.Texture(device, {
    width,
    height,
    format: options.linear ? pc.PIXELFORMAT_RGBA8 : pc.PIXELFORMAT_SRGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: options.repeat ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: options.repeat ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE,
    anisotropy: 8,
    levels: [data]
  });
  return texture;
};

/** Two passes of nearest-opaque-neighbour colour into transparent texels. */
const bleedIntoTransparent = (data: Uint8Array, width: number, height: number) => {
  for (let pass = 0; pass < 3; pass++) {
    const filled = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] !== 0 || (data[i] | data[i + 1] | data[i + 2]) !== 0) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = (ny * width + nx) * 4;
          if (data[j + 3] === 0 && (data[j] | data[j + 1] | data[j + 2]) === 0) continue;
          if (filled[ny * width + nx]) continue;
          data[i] = data[j];
          data[i + 1] = data[j + 1];
          data[i + 2] = data[j + 2];
          filled[y * width + x] = 1;
          break;
        }
      }
    }
  }
};

// ── Meshes ─────────────────────────────────────────────────────────────────

const meshCache = new Map<string, pc.Mesh>();

/**
 * Keep a shared mesh alive across scene loads. PlayCanvas reference-counts
 * meshes through their mesh instances and frees one when the last instance
 * is destroyed — which would free a cached quad the first time a stage is torn
 * down.
 */
export const retain = <T extends pc.Mesh>(mesh: T) => {
  mesh.incRefCount();
  return mesh;
};

const buildMesh = (positions: number[], normals: number[], uvs: number[], indices: number[]) => {
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
};

/** 1×1 quad in the XY plane, pivoted at its bottom centre, facing +Z. */
export const quadMesh = () => {
  let mesh = meshCache.get('quad');
  if (!mesh) {
    mesh = buildMesh(
      [-.5, 0, 0, .5, 0, 0, .5, 1, 0, -.5, 1, 0],
      [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      [0, 0, 1, 0, 1, 1, 0, 1],
      [0, 1, 2, 0, 2, 3]
    );
    retain(mesh);
    meshCache.set('quad', mesh);
  }
  return mesh;
};

/** 1×1 quad centred on the origin, for particles and hanging decorations. */
export const centredQuadMesh = () => {
  let mesh = meshCache.get('centred');
  if (!mesh) {
    mesh = buildMesh(
      [-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0],
      [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      [0, 0, 1, 0, 1, 1, 0, 1],
      [0, 1, 2, 0, 2, 3]
    );
    retain(mesh);
    meshCache.set('centred', mesh);
  }
  return mesh;
};

/** Two unit quads crossed at right angles: a pop-up that reads from any side. */
export const crossedMesh = () => {
  let mesh = meshCache.get('crossed');
  if (!mesh) {
    mesh = buildMesh(
      [
        -.5, 0, 0, .5, 0, 0, .5, 1, 0, -.5, 1, 0,
        0, 0, .5, 0, 0, -.5, 0, 1, -.5, 0, 1, .5
      ],
      [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0],
      [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1],
      [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]
    );
    retain(mesh);
    meshCache.set('crossed', mesh);
  }
  return mesh;
};

/**
 * A ring of vertical quads — a paper backdrop wrapped around the stage. The
 * texture repeats `repeats` times around the circumference.
 */
export const ringMesh = (radius: number, height: number, segments: number, repeats: number, baseY = 0) => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.sin(a) * radius;
    const z = Math.cos(a) * radius;
    positions.push(x, baseY, z, x, baseY + height, z);
    normals.push(-Math.sin(a), 0, -Math.cos(a), -Math.sin(a), 0, -Math.cos(a));
    const u = (i / segments) * repeats;
    uvs.push(u, 0, u, 1);
    if (i < segments) {
      const b = i * 2;
      indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  return buildMesh(positions, normals, uvs, indices);
};

/** Sky dome with a vertical gradient baked into UV v, for an unlit material. */
export const domeMesh = (radius: number) => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rings = 16;
  const segments = 32;
  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const phi = -Math.PI * .15 + v * Math.PI * .65;
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const x = Math.cos(phi) * Math.sin(theta) * radius;
      const y = Math.sin(phi) * radius;
      const z = Math.cos(phi) * Math.cos(theta) * radius;
      positions.push(x, y, z);
      normals.push(-x / radius, -y / radius, -z / radius);
      uvs.push(s / segments, v);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return buildMesh(positions, normals, uvs, indices);
};

/**
 * Folded-paper cottage: a box with a pitched roof, split into three mesh
 * parts so front, side and roof each take their own drawn texture.
 */
export const cottageMeshes = (width: number, depth: number, wallHeight: number, roofHeight: number) => {
  const w = width / 2;
  const d = depth / 2;
  const h = wallHeight;
  const r = h + roofHeight;
  const overhang = .22;
  const gableV = h / r;

  // Front and back: pentagons, facade texture spans wall plus gable.
  const fp: number[] = [];
  const fn: number[] = [];
  const fu: number[] = [];
  const fi: number[] = [];
  for (const side of [1, -1]) {
    const base = fp.length / 3;
    const z = d * side;
    const xs = side;
    fp.push(-w * xs, 0, z, w * xs, 0, z, w * xs, h, z, 0, r, z, -w * xs, h, z);
    for (let i = 0; i < 5; i++) fn.push(0, 0, side);
    fu.push(0, 0, 1, 0, 1, gableV, .5, 1, 0, gableV);
    fi.push(base, base + 1, base + 2, base, base + 2, base + 4, base + 4, base + 2, base + 3);
  }

  // Sides: plain quads.
  const sp: number[] = [];
  const sn: number[] = [];
  const su: number[] = [];
  const si: number[] = [];
  for (const side of [1, -1]) {
    const base = sp.length / 3;
    const x = w * side;
    sp.push(x, 0, d * side, x, 0, -d * side, x, h, -d * side, x, h, d * side);
    for (let i = 0; i < 4; i++) sn.push(side, 0, 0);
    su.push(0, 0, 1, 0, 1, 1, 0, 1);
    si.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Roof: two slabs from eave to ridge, with overhang.
  const rp: number[] = [];
  const rn: number[] = [];
  const ru: number[] = [];
  const ri: number[] = [];
  const slope = Math.hypot(w, roofHeight);
  const ex = (w + overhang) ;
  const ey = h - overhang * roofHeight / w;
  for (const side of [1, -1]) {
    const base = rp.length / 3;
    const dd = d + overhang;
    rp.push(ex * side, ey, dd, ex * side, ey, -dd, 0, r + .04, -dd, 0, r + .04, dd);
    const nx = roofHeight / slope * side;
    const ny = w / slope;
    for (let i = 0; i < 4; i++) rn.push(nx, ny, 0);
    ru.push(0, 0, 1, 0, 1, 1, 0, 1);
    if (side === 1) ri.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else ri.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  return {
    front: buildMesh(fp, fn, fu, fi),
    side: buildMesh(sp, sn, su, si),
    roof: buildMesh(rp, rn, ru, ri)
  };
};

// ── Materials ──────────────────────────────────────────────────────────────

/**
 * Cut paper: alpha-tested against the burn-order alpha, lit on both faces,
 * with a little self-illumination so cutouts facing away from the sun still
 * read as coloured paper rather than silhouettes.
 */
export const cutoutMaterial = (texture: pc.Texture, glow = .28) => {
  const material = new pc.StandardMaterial();
  material.diffuseMap = texture;
  material.opacityMap = texture;
  material.opacityMapChannel = 'a';
  material.alphaTest = .5;
  material.emissiveMap = texture;
  material.emissive = new pc.Color(glow, glow, glow);
  material.emissiveIntensity = 1;
  material.cull = pc.CULLFACE_NONE;
  material.twoSidedLighting = true;
  material.gloss = .12;
  material.metalness = 0;
  material.useMetalness = true;
  material.update();
  return material;
};

/** Opaque folded card — cottages, crates, the ground sheet. */
export const cardMaterial = (texture: pc.Texture, glow = .12, burnable = true) => {
  const material = new pc.StandardMaterial();
  material.diffuseMap = texture;
  if (burnable) {
    material.opacityMap = texture;
    material.opacityMapChannel = 'a';
    material.alphaTest = .5;
  }
  material.emissiveMap = texture;
  material.emissive = new pc.Color(glow, glow, glow);
  material.cull = pc.CULLFACE_NONE;
  material.twoSidedLighting = true;
  material.gloss = .15;
  material.metalness = 0;
  material.useMetalness = true;
  material.update();
  return material;
};

/** Unlit paint: sky, far backdrops, anything the sun should not shade. */
export const paintMaterial = (texture: pc.Texture, alpha = false) => {
  const material = new pc.StandardMaterial();
  material.useLighting = false;
  material.useFog = false;
  material.diffuse = pc.Color.BLACK;
  material.emissiveMap = texture;
  material.emissive = pc.Color.WHITE;
  if (alpha) {
    material.opacityMap = texture;
    material.opacityMapChannel = 'a';
    material.alphaTest = .5;
  }
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
};

/** Additive glow sprite for flames, embers and sparks. */
export const glowMaterial = (texture: pc.Texture, color = new pc.Color(1, 1, 1), intensity = 1) => {
  const material = new pc.StandardMaterial();
  material.useLighting = false;
  material.useFog = false;
  material.diffuse = pc.Color.BLACK;
  material.emissiveMap = texture;
  material.emissive = color;
  material.emissiveIntensity = intensity;
  material.opacityMap = texture;
  material.opacityMapChannel = 'a';
  material.blendType = pc.BLEND_ADDITIVEALPHA;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
};

/** Soft alpha-blended sprite — smoke and ash. */
export const smokeMaterial = (texture: pc.Texture) => {
  const material = new pc.StandardMaterial();
  material.useLighting = false;
  material.diffuse = pc.Color.BLACK;
  material.emissiveMap = texture;
  material.emissive = pc.Color.WHITE;
  material.opacityMap = texture;
  material.opacityMapChannel = 'a';
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
};

export const meshEntity = (
  name: string,
  mesh: pc.Mesh,
  material: pc.Material,
  parent: pc.Entity,
  options: { castShadows?: boolean; receiveShadows?: boolean } = {}
) => {
  const entity = new pc.Entity(name);
  entity.addComponent('render', {
    meshInstances: [new pc.MeshInstance(mesh, material)],
    castShadows: options.castShadows ?? true,
    receiveShadows: options.receiveShadows ?? true
  });
  parent.addChild(entity);
  return entity;
};
