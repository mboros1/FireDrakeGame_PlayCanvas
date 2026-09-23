/**
 * The paper theatre: builds each chapter's set from simulation layout data
 * and animates everything that is scenery rather than simulation — bobbing
 * clouds, swaying bunting, burning props, collapsing cottages.
 */

import * as pc from 'playcanvas';
import {
  COTTAGE_STYLES,
  drawBookGate,
  drawCaveGround,
  drawCaveWall,
  drawCloud,
  drawCottageFront,
  drawCottageSide,
  drawFence,
  drawGarland,
  drawHaystack,
  drawHills,
  drawLavaRiver,
  drawMaypoleStripes,
  drawPennant,
  drawPlainCard,
  drawRoof,
  drawSignpost,
  drawSky,
  drawStalactites,
  drawStall,
  drawStump,
  drawSun,
  drawTree,
  drawVillageGround,
  PALETTE,
  TREE_COLOURS,
  type TreeStyle
} from './art';
import type { Fx } from './fx';
import {
  canvasTexture,
  cardMaterial,
  cottageMeshes,
  crossedMesh,
  cutoutMaterial,
  domeMesh,
  meshEntity,
  paintMaterial,
  quadMesh,
  retain,
  ringMesh
} from './paper';
import { PropKind, PropState, type PropSim } from '../sim/props';
import type { VillageLayout } from '../sim/village';

// ── Shared texture cache: drawn once per session, reused across scene loads ──

const cache = new Map<string, unknown>();
const once = <T>(key: string, make: () => T): T => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
};

const COTTAGE_W = 4.6;
const COTTAGE_D = 4.4;
const COTTAGE_WALL = 3;
const COTTAGE_ROOF = 2.6;
const GABLE_FRACTION = COTTAGE_ROOF / (COTTAGE_WALL + COTTAGE_ROOF);

const TREE_STYLES: TreeStyle[] = ['lollipop', 'pine', 'cloud', 'poplar'];

const treeMaterial = (variant: number) => {
  const style = TREE_STYLES[variant % TREE_STYLES.length];
  // Pines stay green; everything else takes autumn.
  const colours = style === 'pine'
    ? TREE_COLOURS[2 + (variant >> 2) % 2]
    : TREE_COLOURS[(variant >> 2) % TREE_COLOURS.length];
  const key = `tree:${style}:${colours[1]}`;
  return once(key, () => cutoutMaterial(canvasTexture(drawTree(style, colours, variant % 97 + 3), { burnable: true, seed: variant })));
};

const cottageMaterials = (variant: number) => {
  const style = COTTAGE_STYLES[variant % COTTAGE_STYLES.length];
  return once(`cottage:${style.seed}`, () => ({
    front: cardMaterial(canvasTexture(drawCottageFront(style, GABLE_FRACTION), { burnable: true, seed: style.seed })),
    side: cardMaterial(canvasTexture(drawCottageSide(style), { burnable: true, seed: style.seed + 1 })),
    roof: cardMaterial(canvasTexture(drawRoof(style), { burnable: true, seed: style.seed + 2 }), .08)
  }));
};

// ── Burnable view: tints, dissolves and collapses a group of mesh instances ──

type BurnMaterial = { material: pc.StandardMaterial; baseEmissive: number };

/**
 * View half of a prop. Owns its entities and a private copy of its materials
 * once it starts burning — shared materials are cloned on ignition so one
 * burning cottage does not char every cottage in the village.
 */
class PropView {
  readonly root: pc.Entity;
  private burnMaterials: BurnMaterial[] | null = null;
  private squash = 1;
  private squashVelocity = 0;
  private charredAt = -1;
  private smokeTimer = 0;
  private swapped = false;
  private readonly scratch = new pc.Vec3();
  private tilt = 0;

  constructor(
    readonly sim: PropSim,
    parent: pc.Entity,
    private readonly height: number,
    private readonly fireRadius: number,
    private readonly stumpMaterial: pc.Material | null
  ) {
    this.root = new pc.Entity(`Prop ${PropKind[sim.kind]}`);
    this.root.setPosition(sim.x, 0, sim.z);
    parent.addChild(this.root);
  }

  private meshInstances() {
    const out: pc.MeshInstance[] = [];
    for (const render of this.root.findComponents('render') as pc.RenderComponent[]) out.push(...render.meshInstances);
    return out;
  }

  private ensureBurnMaterials() {
    if (this.burnMaterials) return this.burnMaterials;
    const clones = new Map<pc.Material, BurnMaterial>();
    for (const mi of this.meshInstances()) {
      let entry = clones.get(mi.material);
      if (!entry) {
        const material = (mi.material as pc.StandardMaterial).clone();
        material.update();
        entry = { material, baseEmissive: (mi.material as pc.StandardMaterial).emissive.r };
        clones.set(mi.material, entry);
      }
      mi.material = entry.material;
    }
    this.burnMaterials = [...clones.values()];
    return this.burnMaterials;
  }

  get firePosition() {
    return this.root.getPosition();
  }

  update(dt: number, elapsed: number, fx: Fx) {
    const sim = this.sim;

    // Flattening: a sprung squash with overshoot, like a pop-up folding shut.
    const targetSquash = sim.state === PropState.Flattened || (sim.state !== PropState.Intact && this.squash < .5) ? .09 : 1;
    this.squashVelocity += (targetSquash - this.squash) * 180 * dt;
    this.squashVelocity *= Math.max(0, 1 - 14 * dt);
    this.squash = Math.max(.04, this.squash + this.squashVelocity * dt);

    const progress = sim.burnProgress;
    if (sim.state === PropState.Burning || sim.state === PropState.Charred) {
      const materials = this.ensureBurnMaterials();
      const char = Math.min(1, progress * 1.4);
      const glow = sim.state === PropState.Burning ? Math.sin(Math.min(1, progress * 1.25) * Math.PI) : 0;
      const pulse = .7 + Math.sin(elapsed * 13 + sim.x) * .15 + Math.sin(elapsed * 29 + sim.z) * .15;
      // Paper keeps its outline but loses up to 85% of its body.
      const eaten = sim.kind === PropKind.Cottage ? .72 : sim.kind === PropKind.Tree ? .86 : .96;
      for (const { material, baseEmissive } of materials) {
        const shade = 1 - Math.min(1, char * 1.3) * .88;
        material.diffuse.set(shade, shade * (1 - char * .1), shade * (1 - char * .2));
        // Never quite black: PlayCanvas warns about an emissive map with no colour.
        const e = Math.max(.004, baseEmissive * (1 - char));
        const heat = glow * pulse;
        material.emissive.set(e + heat * .75, e + heat * .3, e + heat * .06);
        material.emissiveIntensity = 1;
        material.alphaTest = .5 + Math.min(1, progress * 1.1) * (eaten - .5);
        material.update();
      }

      if (sim.state === PropState.Burning) {
        const intensity = Math.max(.25, glow);
        this.scratch.copy(this.root.getPosition());
        if (sim.kind === PropKind.Cottage && this.squash > .5) {
          // Flames belong on the outside of a house: along the roof, and
          // licking out of the walls. Spawned at the centre they hide inside.
          const s = sim.size;
          this.scratch.y += COTTAGE_WALL * s;
          fx.burn(this.scratch, COTTAGE_W * .45 * s, COTTAGE_ROOF * s * 1.1, intensity, dt);
          this.scratch.y -= COTTAGE_WALL * s * .7;
          fx.burn(this.scratch, COTTAGE_W * .62 * s, COTTAGE_WALL * s * .6, intensity * .6, dt);
        } else {
          fx.burn(this.scratch, this.fireRadius, Math.max(.6, this.height * this.squash * .8), intensity, dt);
        }
        // Cottages sag and lean as they burn.
        if (sim.kind === PropKind.Cottage) this.tilt = Math.min(1, progress) * 7;
      } else {
        if (this.charredAt < 0) this.charredAt = elapsed;
        // Trees give up their crowns and leave a stump.
        if (this.stumpMaterial && !this.swapped) {
          this.swapped = true;
          for (const mi of this.meshInstances()) mi.material = this.stumpMaterial;
          this.root.setLocalScale(this.root.getLocalScale().x * .55, this.root.getLocalScale().y * .45, this.root.getLocalScale().z * .55);
        }
        // Smoulder for a while.
        const since = elapsed - this.charredAt;
        this.smokeTimer -= dt;
        if (since < 14 && this.smokeTimer <= 0) {
          this.smokeTimer = .35 + since * .08;
          this.scratch.copy(this.root.getPosition());
          this.scratch.y += this.height * .3;
          fx.spawn('smoke', this.scratch, new pc.Vec3((Math.random() - .5) * .5, 1.5, (Math.random() - .5) * .5),
            { life: 2.4, size: .6 + this.fireRadius * .3, grow: 1.3, drag: .2, spin: 25 });
        }
      }
    }

    const scale = this.root.getLocalScale();
    const inner = this.root.children[0];
    if (inner) {
      inner.setLocalScale(1 + (1 - this.squash) * .12, this.squash, 1 + (1 - this.squash) * .12);
      inner.setLocalEulerAngles(this.tilt, 0, this.tilt * .5);
    }
    void scale;
  }

  get burning() {
    return this.sim.state === PropState.Burning;
  }

  get fireStrength() {
    return this.sim.state === PropState.Burning ? Math.sin(Math.min(1, this.sim.burnProgress * 1.25) * Math.PI) * this.fireRadius : 0;
  }
}

// ── Stage ────────────────────────────────────────────────────────────────────

type Swayer = { entity: pc.Entity; phase: number; amount: number; speed: number; axis: 'x' | 'z'; base: pc.Vec3 };
type Bobber = { entity: pc.Entity; phase: number; base: pc.Vec3; amount: number };

export class Stage {
  readonly root = new pc.Entity('Stage');
  readonly props: PropView[] = [];
  private readonly swayers: Swayer[] = [];
  private readonly bobbers: Bobber[] = [];
  private lava: pc.StandardMaterial | null = null;
  private gateGlow: pc.Entity | null = null;

  constructor(parent: pc.Entity) {
    parent.addChild(this.root);
  }

  destroy() {
    this.root.destroy();
  }

  // ── Chapter the Second: Little Kindling ──────────────────────────────────

  buildVillage(layout: VillageLayout, props: PropSim[]) {
    const root = this.root;
    this.buildSky([[0, '#f6b489'], [.18, '#f7cfa4'], [.45, '#b9d3d0'], [1, '#6f9fbf']], 0);

    // Stage floor, then the table beyond it.
    const groundTexture = once('ground:village', () => canvasTexture(drawVillageGround(layout.paths, layout.pond), { softAlpha: true }));
    const ground = new pc.Entity('Village ground');
    ground.addComponent('render', { type: 'plane', castShadows: false, receiveShadows: true });
    ground.render!.material = once('mat:ground', () => cardMaterial(groundTexture, .05, false));
    ground.setLocalScale(116, 1, 116);
    root.addChild(ground);

    const beyond = new pc.Entity('Meadow beyond the page');
    beyond.addComponent('render', { type: 'plane', castShadows: false, receiveShadows: false });
    const beyondMaterial = once('mat:beyond', () => {
      const m = cardMaterial(canvasTexture(drawPlainCard('#7a9c68', 8), { softAlpha: true, repeat: true }), .1, false);
      m.diffuseMapTiling = new pc.Vec2(40, 40);
      m.emissiveMapTiling = new pc.Vec2(40, 40);
      m.update();
      return m;
    });
    beyond.render!.material = beyondMaterial;
    beyond.setLocalScale(520, 1, 520);
    beyond.setLocalPosition(0, -.03, 0);
    root.addChild(beyond);

    // Paper hills, nearest first, fading towards the sky.
    const hillLayers: [number, number, string, string][] = [
      [74, 12, '#5f8a5a', '#86ad76'],
      [100, 20, '#7ea283', '#a4c3a0'],
      [135, 30, '#a3bfae', '#c6d9cb'],
      [180, 44, '#c7d6cc', '#e1e7de']
    ];
    hillLayers.forEach(([radius, height, fill, rim], i) => {
      const texture = once(`hills:${i}`, () => canvasTexture(drawHills(fill, rim, i * 3 + 1)));
      const material = i === 0 ? cutoutMaterial(texture, .45) : paintMaterial(texture, true);
      const entity = meshEntity(`Hills ${i}`, ringMesh(radius, height, 64, 3 + i), material, root, { castShadows: false, receiveShadows: i === 0 });
      entity.setLocalEulerAngles(0, i * 37, 0);
    });

    // Sun and clouds, all hung on visible strings from the top of the theatre.
    const sunMaterial = once('mat:sun', () => paintMaterial(canvasTexture(drawSun()), true));
    const sun = meshEntity('Paper sun', quadMesh(), sunMaterial, root, { castShadows: false, receiveShadows: false });
    sun.setLocalScale(48, 48, 1);
    sun.setPosition(-110, 52, -190);
    sun.lookAt(0, 70, 0);
    sun.rotateLocal(0, 180, 0);
    this.bobbers.push({ entity: sun, phase: 0, base: sun.getLocalPosition().clone(), amount: 1.2 });
    this.hang(sun.getPosition().clone().add(new pc.Vec3(0, 47, 0)), 200);

    const cloudMaterials = [1, 2, 3].map(s => once(`mat:cloud${s}`, () => paintMaterial(canvasTexture(drawCloud(s * 11)), true)));
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + .4;
      const radius = 110 + (i % 3) * 25;
      const cloud = meshEntity('Cloud', quadMesh(), cloudMaterials[i % 3], root, { castShadows: false, receiveShadows: false });
      const scale = 18 + (i % 4) * 5;
      cloud.setLocalScale(scale, scale / 2, 1);
      cloud.setPosition(Math.sin(a) * radius, 32 + (i % 4) * 7, Math.cos(a) * radius);
      cloud.lookAt(0, cloud.getPosition().y, 0);
      cloud.rotateLocal(0, 180, 0);
      this.bobbers.push({ entity: cloud, phase: i * 1.3, base: cloud.getLocalPosition().clone(), amount: 1.6 });
      this.hang(cloud.getPosition().clone().add(new pc.Vec3(0, scale / 2 - 1, 0)), 180);
    }

    // Props from the simulation layout.
    const placementById = new Map(layout.props.map((p, i) => [i, p]));
    props.forEach((sim, i) => {
      const placement = placementById.get(i)!;
      this.props.push(this.buildProp(sim, placement.variant, placement.yaw));
    });

    // Bunting from the maypole's crown to every cottage roof.
    const pennants = [PALETTE.berry, PALETTE.saffron, PALETTE.teal, PALETTE.rust, PALETTE.paper, PALETTE.plum]
      .map((c, i) => once(`mat:pennant${i}`, () => cutoutMaterial(canvasTexture(drawPennant(c, i + 1), { burnable: true }), .35)));
    const crown = new pc.Vec3(0, 7.8, 0);
    for (const placement of layout.props) {
      if (placement.kind !== PropKind.Cottage) continue;
      const end = new pc.Vec3(placement.x * .86, (COTTAGE_WALL + COTTAGE_ROOF) * placement.size * .9, placement.z * .86);
      this.bunting(crown, end, pennants);
    }
  }

  private hang(from: pc.Vec3, length: number) {
    const material = once('mat:string', () => paintMaterial(canvasTexture(drawPlainCard('#6b5a55'), { softAlpha: true })));
    const string = new pc.Entity('String');
    string.addComponent('render', { type: 'box', castShadows: false, receiveShadows: false });
    string.render!.material = material;
    string.setLocalScale(.18, length, .18);
    string.setPosition(from.x, from.y + length / 2, from.z);
    this.root.addChild(string);
  }

  private bunting(from: pc.Vec3, to: pc.Vec3, materials: pc.Material[]) {
    const line = new pc.Entity('Bunting');
    this.root.addChild(line);
    const length = from.distance(to);
    const count = Math.floor(length / .75);
    const sag = length * .12;
    const cord = once('mat:cord', () => cardMaterial(canvasTexture(drawPlainCard('#f3ead8'), { softAlpha: true }), .4, false));
    let previous = from.clone();
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      const p = new pc.Vec3().lerp(from, to, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      // Cord segment.
      const segment = new pc.Entity('Cord');
      segment.addComponent('render', { type: 'box', castShadows: false });
      segment.render!.material = cord;
      const mid = new pc.Vec3().lerp(previous, p, .5);
      segment.setPosition(mid);
      segment.lookAt(p);
      segment.setLocalScale(.03, .03, previous.distance(p));
      line.addChild(segment);
      previous = p;
      if (i === count) break;
      const pennant = meshEntity('Pennant', quadMesh(), materials[i % materials.length], line, { castShadows: true });
      pennant.setPosition(p.x, p.y - .5, p.z);
      pennant.setLocalScale(.36, .5, 1);
      const direction = new pc.Vec3().sub2(to, from);
      pennant.setEulerAngles(0, Math.atan2(direction.x, direction.z) * pc.math.RAD_TO_DEG + 90, 0);
      this.swayers.push({ entity: pennant, phase: i * .7 + from.x, amount: 12, speed: 3.2, axis: 'x', base: pennant.getLocalEulerAngles().clone() });
    }
  }

  private buildProp(sim: PropSim, variant: number, yaw: number): PropView {
    const size = sim.size;
    switch (sim.kind) {
      case PropKind.Tree: {
        const stump = once('mat:stump', () => cutoutMaterial(canvasTexture(drawStump(5)), .15));
        const view = new PropView(sim, this.root, 5.6 * size, 1.4 * size, stump);
        const inner = new pc.Entity('Tree pivot');
        view.root.addChild(inner);
        const tree = meshEntity('Tree', crossedMesh(), treeMaterial(variant), inner);
        const style = TREE_STYLES[variant % TREE_STYLES.length];
        const width = style === 'poplar' ? 2.6 : style === 'pine' ? 3.4 : 3.9;
        tree.setLocalScale(width * size, 5.8 * size, width * size);
        view.root.setLocalEulerAngles(0, yaw, 0);
        return view;
      }
      case PropKind.Cottage: {
        const view = new PropView(sim, this.root, (COTTAGE_WALL + COTTAGE_ROOF) * size, 2.6 * size, null);
        const inner = new pc.Entity('Cottage pivot');
        view.root.addChild(inner);
        const meshes = once('mesh:cottage', () => {
          const m = cottageMeshes(COTTAGE_W, COTTAGE_D, COTTAGE_WALL, COTTAGE_ROOF);
          retain(m.front); retain(m.side); retain(m.roof);
          return m;
        });
        const materials = cottageMaterials(variant);
        meshEntity('Facade', meshes.front, materials.front, inner);
        meshEntity('Walls', meshes.side, materials.side, inner);
        meshEntity('Roof', meshes.roof, materials.roof, inner);
        // Chimney.
        const chimney = new pc.Entity('Chimney');
        chimney.addComponent('render', { type: 'box' });
        chimney.render!.material = once('mat:chimney', () => cardMaterial(canvasTexture(drawPlainCard('#a2533a', 4), { softAlpha: true }), .1, false));
        chimney.setLocalScale(.6, 1.6, .6);
        chimney.setLocalPosition(COTTAGE_W * .22, COTTAGE_WALL + COTTAGE_ROOF * .7, -COTTAGE_D * .2);
        inner.addChild(chimney);
        view.root.setLocalScale(size, size, size);
        view.root.setLocalEulerAngles(0, yaw, 0);
        return view;
      }
      case PropKind.Haystack: {
        const material = once(`mat:hay${variant % 3}`, () => cutoutMaterial(canvasTexture(drawHaystack(variant % 3 + 1), { burnable: true }), .3));
        const view = new PropView(sim, this.root, 2 * size, 1.2 * size, null);
        const inner = new pc.Entity('Hay pivot');
        view.root.addChild(inner);
        const hay = meshEntity('Haystack', crossedMesh(), material, inner);
        hay.setLocalScale(2.6 * size, 2.1 * size, 2.6 * size);
        view.root.setLocalEulerAngles(0, yaw, 0);
        return view;
      }
      case PropKind.Stall: {
        const awnings = [PALETTE.berry, PALETTE.teal, PALETTE.rust, PALETTE.plum];
        const material = once(`mat:stall${variant % 4}`, () => cutoutMaterial(canvasTexture(drawStall(awnings[variant % 4], variant + 1), { burnable: true }), .3));
        const view = new PropView(sim, this.root, 3 * size, 1.4 * size, null);
        const inner = new pc.Entity('Stall pivot');
        view.root.addChild(inner);
        const stall = meshEntity('Stall', quadMesh(), material, inner);
        stall.setLocalScale(3.4 * size, 3.4 * size, 1);
        // A back panel so the stall is not a single sheet from behind.
        const back = meshEntity('Stall back', quadMesh(), material, inner);
        back.setLocalScale(3.4 * size, 3.4 * size, 1);
        back.setLocalPosition(0, 0, -.9);
        view.root.setLocalEulerAngles(0, yaw, 0);
        return view;
      }
      case PropKind.Fence: {
        const material = once('mat:fence', () => cutoutMaterial(canvasTexture(drawFence(3), { burnable: true }), .35));
        const view = new PropView(sim, this.root, 1.2, .8, null);
        const inner = new pc.Entity('Fence pivot');
        view.root.addChild(inner);
        const fence = meshEntity('Fence', quadMesh(), material, inner);
        fence.setLocalScale(3.4, 1.28, 1);
        view.root.setLocalEulerAngles(0, yaw, 0);
        return view;
      }
      case PropKind.Signpost: {
        const material = once('mat:signpost', () => cutoutMaterial(canvasTexture(drawSignpost(), { burnable: true }), .35));
        const view = new PropView(sim, this.root, 2.6, .5, null);
        const inner = new pc.Entity('Signpost pivot');
        view.root.addChild(inner);
        const sign = meshEntity('Signpost', quadMesh(), material, inner);
        sign.setLocalScale(1.6, 3.2, 1);
        view.root.setLocalEulerAngles(0, yaw, 0);
        return view;
      }
      case PropKind.Maypole:
      default: {
        const view = new PropView(sim, this.root, 8, .7, null);
        const inner = new pc.Entity('Maypole pivot');
        view.root.addChild(inner);
        const pole = new pc.Entity('Pole');
        pole.addComponent('render', { type: 'cylinder' });
        pole.render!.material = once('mat:maypole', () => cardMaterial(canvasTexture(drawMaypoleStripes(), { burnable: true }), .25));
        pole.setLocalScale(.34, 8, .34);
        pole.setLocalPosition(0, 4, 0);
        inner.addChild(pole);
        const garland = once('mat:garland', () => cutoutMaterial(canvasTexture(drawGarland(), { burnable: true }), .4));
        const wreath = meshEntity('Garland', crossedMesh(), garland, inner);
        wreath.setLocalScale(1.8, .9, 1.8);
        wreath.setLocalPosition(0, 7.4, 0);
        // Ribbons to pegs in the grass.
        const ribbonColours = [PALETTE.berry, PALETTE.saffron, PALETTE.teal, PALETTE.rust, PALETTE.plum, PALETTE.paper];
        ribbonColours.forEach((colour, i) => {
          const a = (i / ribbonColours.length) * Math.PI * 2;
          const peg = new pc.Vec3(Math.sin(a) * 3.4, .05, Math.cos(a) * 3.4);
          const top = new pc.Vec3(0, 7.6, 0);
          const ribbon = new pc.Entity('Ribbon');
          ribbon.addComponent('render', { type: 'box' });
          ribbon.render!.material = once(`mat:ribbon${i}`, () => cardMaterial(canvasTexture(drawPlainCard(colour, i), { softAlpha: true }), .3, false));
          const mid = new pc.Vec3().lerp(peg, top, .5);
          ribbon.setLocalPosition(mid);
          inner.addChild(ribbon);
          ribbon.lookAt(new pc.Vec3().add2(top, view.root.getPosition()));
          ribbon.setLocalScale(.12, .02, peg.distance(top));
        });
        return view;
      }
    }
  }

  // ── Chapter the First: the Hoard ─────────────────────────────────────────

  buildCave() {
    const root = this.root;
    this.buildSky([[0, '#1a0f1c'], [.5, '#2a1424'], [1, '#12091a']], 1);

    const ground = new pc.Entity('Cave floor');
    ground.addComponent('render', { type: 'plane', castShadows: false });
    ground.render!.material = once('mat:caveGround', () => {
      const m = cardMaterial(canvasTexture(drawCaveGround(), { softAlpha: true }), .08, false);
      m.diffuseMapTiling = new pc.Vec2(3, 3);
      m.emissiveMapTiling = new pc.Vec2(3, 3);
      m.update();
      return m;
    });
    ground.setLocalScale(116, 1, 116);
    root.addChild(ground);

    // The lava river: a scrolling paper ribbon, lit from inside.
    const lava = new pc.Entity('Lava river');
    lava.addComponent('render', { type: 'plane', castShadows: false, receiveShadows: false });
    const lavaMaterial = once('mat:lava', () => {
      const m = new pc.StandardMaterial();
      const tex = canvasTexture(drawLavaRiver(), { softAlpha: true, repeat: true });
      m.diffuse = new pc.Color(.1, .02, .01);
      m.emissiveMap = tex;
      m.emissive = pc.Color.WHITE;
      m.emissiveIntensity = 1.15;
      m.emissiveMapTiling = new pc.Vec2(1, 8);
      m.useFog = false;
      m.update();
      return m;
    });
    this.lava = lavaMaterial;
    lava.render!.material = lavaMaterial;
    lava.setLocalScale(7, 1, 116);
    lava.setLocalPosition(0, .03, 0);
    root.addChild(lava);

    // Glow along the lava.
    for (let z = -50; z <= 50; z += 20) {
      const light = new pc.Entity('Lava glow');
      light.addComponent('light', { type: 'omni', color: new pc.Color(1, .38, .1), intensity: 5, range: 18, castShadows: false });
      light.setLocalPosition(0, 1.4, z);
      root.addChild(light);
    }

    // Cave walls: jagged rings, darkest nearest the lava's light.
    const walls: [number, number, string, string][] = [
      [60, 26, '#3b1f33', '#6b2c3c'],
      [80, 38, '#2c1a2c', '#4a2236'],
      [110, 60, '#1f1424', '#35192b']
    ];
    walls.forEach(([radius, height, fill, rim], i) => {
      const texture = once(`caveWall:${i}`, () => canvasTexture(drawCaveWall(fill, rim, i + 20)));
      const material = i === 0 ? cutoutMaterial(texture, .2) : paintMaterial(texture, true);
      meshEntity(`Cave wall ${i}`, ringMesh(radius, height, 48, 4 + i), material, root, { castShadows: false, receiveShadows: i === 0 });
    });
    const stalactiteTexture = once('stalactites', () => canvasTexture(drawStalactites('#2c1a2c', 31)));
    const stalactites = meshEntity('Stalactites', ringMesh(48, 14, 48, 6, 18), paintMaterial(stalactiteTexture, true), root, { castShadows: false, receiveShadows: false });
    stalactites.setLocalScale(1, -1, 1);
    stalactites.setLocalPosition(0, 50, 0);

    // Hoard heaps: gold mounds of coin sprites flanking the path.
    const coinHeap = once('mat:hoard', () => {
      const tex = canvasTexture(drawHoard(), { burnable: false });
      const m = cutoutMaterial(tex, .9);
      m.emissiveIntensity = 1.4;
      m.update();
      return m;
    });
    const heaps: [number, number, number][] = [[-14, 20, 1.3], [16, 8, 1.6], [-20, -12, 2], [22, -26, 1.4], [-11, -30, 1.1], [12, 30, 1]];
    for (const [x, z, s] of heaps) {
      const heap = meshEntity('Hoard heap', crossedMesh(), coinHeap, root);
      heap.setLocalScale(6 * s, 3 * s, 6 * s);
      heap.setLocalPosition(x, 0, z);
      heap.setLocalEulerAngles(0, x * 7, 0);
    }

    // Crystal columns.
    const crystal = once('mat:crystal', () => {
      const m = new pc.StandardMaterial();
      m.diffuse = new pc.Color(.25, .6, .62);
      m.emissive = new pc.Color(.2, .75, .7);
      m.emissiveIntensity = 1.2;
      m.gloss = .8;
      m.metalness = .1;
      m.useMetalness = true;
      m.update();
      return m;
    });
    for (let i = 0; i < 22; i++) {
      const side = i % 2 ? -1 : 1;
      const cluster = new pc.Entity('Crystal');
      cluster.addComponent('render', { type: 'cone' });
      cluster.render!.material = crystal;
      const h = 1.5 + (i * 37 % 17) / 4;
      cluster.setLocalScale(.6 + (i % 3) * .3, h, .6 + (i % 3) * .3);
      cluster.setLocalPosition(side * (12 + (i * 53 % 30)), h / 2, -48 + (i * 71 % 100));
      cluster.setLocalEulerAngles((i % 5) * 6 - 12, 0, (i % 7) * 4 - 12);
      root.addChild(cluster);
    }

    // The gate out: a giant storybook, open, stood on its end.
    const gate = meshEntity('Book gate', quadMesh(), once('mat:book', () => cutoutMaterial(canvasTexture(drawBookGate()), .7)), root);
    gate.setLocalScale(16, 12, 1);
    gate.setLocalPosition(0, 0, -46);
    const glow = new pc.Entity('Gate glow');
    glow.addComponent('light', { type: 'omni', color: new pc.Color(1, .85, .55), intensity: 6, range: 22, castShadows: false });
    glow.setLocalPosition(0, 5, -43);
    root.addChild(glow);
    this.gateGlow = glow;
  }

  private buildSky(stops: [number, string][], key: number) {
    const texture = once(`sky:${key}`, () => canvasTexture(drawSky(stops), { softAlpha: true }));
    const material = paintMaterial(texture);
    material.depthWrite = false;
    material.update();
    const dome = meshEntity('Sky', domeMesh(320), material, this.root, { castShadows: false, receiveShadows: false });
    dome.render!.layers = [pc.LAYERID_SKYBOX];
    void dome;
  }

  update(dt: number, elapsed: number, fx: Fx) {
    for (const b of this.bobbers) {
      b.entity.setLocalPosition(b.base.x, b.base.y + Math.sin(elapsed * .5 + b.phase) * b.amount, b.base.z);
    }
    for (const s of this.swayers) {
      const angle = Math.sin(elapsed * s.speed + s.phase) * s.amount;
      s.entity.setLocalEulerAngles(s.base.x + (s.axis === 'x' ? angle : 0), s.base.y, s.base.z + (s.axis === 'z' ? angle : 0));
    }
    if (this.lava) {
      this.lava.emissiveMapOffset = new pc.Vec2(0, (elapsed * .04) % 1);
      this.lava.emissiveIntensity = 1.1 + Math.sin(elapsed * 1.7) * .15;
      this.lava.update();
    }
    if (this.gateGlow) {
      this.gateGlow.light!.intensity = 5 + Math.sin(elapsed * 2.2) * 1.5;
    }
    const fires: { position: pc.Vec3; strength: number }[] = [];
    for (const prop of this.props) {
      prop.update(dt, elapsed, fx);
      if (prop.burning) fires.push({ position: prop.firePosition, strength: Math.min(1.6, prop.fireStrength * .5 + .3) });
    }
    return fires;
  }
}

/** A heap of gold coins with a goblet and a crown in it. 512×256. */
const drawHoard = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = '#b9862a';
  ctx.beginPath();
  ctx.moveTo(10, 256);
  ctx.quadraticCurveTo(256, -40, 502, 256);
  ctx.fill();
  for (let i = 0; i < 260; i++) {
    const t = r();
    const x = 20 + t * 472;
    const top = 256 - Math.sin(t * Math.PI) * 150;
    const y = top + r() * (256 - top);
    ctx.fillStyle = r() < .5 ? PALETTE.gold : '#ffd97a';
    ctx.beginPath(); ctx.ellipse(x, y, 11, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#9a6d1c';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Goblet.
  ctx.fillStyle = '#e8b83f';
  ctx.beginPath(); ctx.moveTo(300, 90); ctx.lineTo(340, 90); ctx.lineTo(326, 130); ctx.lineTo(314, 130); ctx.fill();
  ctx.fillRect(316, 130, 8, 20);
  ctx.fillRect(304, 150, 32, 6);
  // Crown.
  ctx.fillStyle = '#f7cf55';
  ctx.beginPath();
  ctx.moveTo(170, 130); ctx.lineTo(176, 96); ctx.lineTo(190, 116); ctx.lineTo(202, 90); ctx.lineTo(214, 116); ctx.lineTo(228, 96); ctx.lineTo(234, 130);
  ctx.fill();
  ctx.fillStyle = PALETTE.berry;
  ctx.beginPath(); ctx.arc(202, 120, 5, 0, Math.PI * 2); ctx.fill();
  return canvas;
};
