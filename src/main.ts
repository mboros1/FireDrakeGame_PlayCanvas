import * as pc from 'playcanvas';
import './style.css';
import { TUNING } from './tuning';
import { World } from './sim/world';
import { DrakeSim } from './sim/drake';
import type { Input, Transform } from './sim/types';

type SceneName = 'cave' | 'forest' | 'forestExtract';
type SavedState = { scene: SceneName; x: number; z: number; yaw: number };
type ForestAsset = {
  name: string;
  category: string;
  browser_glb: string;
  exported: boolean;
};
type ForestInstance = {
  name: string;
  source: 'placed_actor' | 'foliage';
  mesh: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};
type ForestManifest = {
  source_level: string;
  sector: {
    browser_ground_size_m: number;
    player_start_position: [number, number, number];
    radius_cm: number;
  };
  assets: Record<string, ForestAsset>;
  instances: ForestInstance[];
  skipped_foliage: { mesh: string; nearby_instances: number; reason: string }[];
};

declare global {
  interface Window {
    __FIRE_DRAKE_DEBUG__: {
      getState: () => object;
      teleport: (x: number, z: number) => void;
      loadScene: (name: SceneName) => void;
      resetCamera: () => void;
    };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const objective = document.querySelector<HTMLDivElement>('#objective')!;
const stats = document.querySelector<HTMLDivElement>('#stats')!;
const loading = document.querySelector<HTMLDivElement>('#loading')!;

const previous = import.meta.hot?.data.state as SavedState | undefined;
const app = new pc.Application(canvas, {
  graphicsDeviceOptions: { antialias: true, alpha: false }
});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.start();

const material = (color: pc.Color, emissive?: pc.Color) => {
  const result = new pc.StandardMaterial();
  result.diffuse = color;
  result.gloss = 18;
  if (emissive) {
    result.emissive = emissive;
    result.emissiveIntensity = 2.2;
  }
  result.update();
  return result;
};

const mats = {
  lava: material(new pc.Color(.24, .025, .005), new pc.Color(1, .09, .005)),
  rock: material(new pc.Color(.13, .105, .09)),
  grass: material(new pc.Color(.12, .32, .09)),
  grass2: material(new pc.Color(.22, .43, .12)),
  bark: material(new pc.Color(.22, .11, .045)),
  leaf: material(new pc.Color(.19, .48, .12)),
  leaf2: material(new pc.Color(.42, .62, .12)),
  drake: material(new pc.Color(.38, .035, .018)),
  wing: material(new pc.Color(.65, .09, .025)),
  dwarf: material(new pc.Color(.24, .29, .34)),
  skin: material(new pc.Color(.62, .34, .20)),
  fire: material(new pc.Color(1, .18, .01), new pc.Color(1, .1, .005)),
  gold: material(new pc.Color(.55, .3, .04), new pc.Color(.15, .055, 0)),
  extractedTree: material(new pc.Color(.2, .43, .12)),
  extractedBush: material(new pc.Color(.28, .5, .13)),
  extractedStone: material(new pc.Color(.29, .31, .27)),
  extractedFlower: material(new pc.Color(.75, .22, .48)),
  extractedMushroom: material(new pc.Color(.72, .36, .12)),
  extractedMonument: material(new pc.Color(.46, .39, .24))
};

const world = new pc.Entity('World');
app.root.addChild(world);

/**
 * Simulation state. Being migrated out of this file — see
 * `docs/ARCHITECTURE.md` phase 1. Everything under `src/sim/` is free of
 * PlayCanvas and is what phase 3 replaces with forge on wasm32.
 */
const simWorld = new World();

/** Reused per frame so the input path allocates nothing. */
const frameInput: Input = {
  forward: 0,
  right: 0,
  charging: false,
  breathing: false,
  cameraYaw: 0
};

/** Reused for cold single-entity transform reads. */
const scratch: Transform = { x: 0, y: 0, z: 0, yaw: 0 };

/** View → sim: raw key state becomes the tick's declared intent. */
const readInput = (): Input => {
  frameInput.forward =
    (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
    (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  frameInput.right =
    (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
    (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  frameInput.charging = keys.has('ShiftLeft') || keys.has('ShiftRight');
  frameInput.breathing = keys.has('Space');
  frameInput.cameraYaw = cameraYaw;
  return frameInput;
};

const makePrimitive = (
  name: string,
  type: 'box' | 'sphere' | 'cylinder' | 'cone' | 'capsule',
  parent: pc.Entity,
  position: pc.Vec3,
  scale: pc.Vec3,
  mat: pc.Material,
  rotation = new pc.Vec3()
) => {
  const entity = new pc.Entity(name);
  entity.addComponent('render', { type });
  entity.render!.material = mat;
  entity.setLocalPosition(position);
  entity.setLocalEulerAngles(rotation);
  entity.setLocalScale(scale);
  parent.addChild(entity);
  return entity;
};

const camera = new pc.Entity('Camera');
camera.addComponent('camera', {
  clearColor: new pc.Color(.06, .08, .05),
  farClip: 350,
  fov: TUNING.camera.fov
});
app.root.addChild(camera);

const sun = new pc.Entity('Sun');
sun.addComponent('light', {
  type: 'directional',
  color: new pc.Color(1, .8, .58),
  intensity: 1.8,
  castShadows: true,
  shadowDistance: 100
});
sun.setEulerAngles(42, 28, 0);
app.root.addChild(sun);

app.scene.ambientLight = new pc.Color(.18, .2, .16);

const loadAsset = (url: string, type: string) =>
  new Promise<pc.Asset>((resolve, reject) => {
    app.assets.loadFromUrl(url, type, (error, asset) => {
      if (error || !asset) reject(new Error(String(error ?? `Could not load ${url}`)));
      else resolve(asset);
    });
  });

/**
 * View-side drake: owns the model, materials and presentation. Gameplay state
 * lives in `DrakeSim`; this class reads it and draws it.
 */
class Drake {
  readonly root = new pc.Entity('Drake');
  readonly sim: DrakeSim;
  modelReady = false;
  private headNode: pc.GraphNode | null = null;
  private tailNode: pc.GraphNode | null = null;
  private readonly visual = new pc.Entity('Fire Drake Visual');
  private readonly placeholder = new pc.Entity('Loading Drake');

  constructor() {
    this.sim = new DrakeSim(simWorld, previous?.x ?? 0, previous?.z ?? 13, previous?.yaw ?? 0);
    this.root.addChild(this.visual);
    this.visual.addChild(this.placeholder);
    makePrimitive('Body', 'capsule', this.placeholder, new pc.Vec3(0, 1.35, 0), new pc.Vec3(1.5, .65, .75), mats.drake, new pc.Vec3(0, 0, 90));
    makePrimitive('Head', 'box', this.placeholder, new pc.Vec3(0, 2, -2), new pc.Vec3(.72, .48, 1.05), mats.drake);
    world.addChild(this.root);
    this.syncFromSim();
    void this.loadRealModel();
  }

  get yaw() {
    simWorld.state.transform(this.sim.id, scratch);
    return scratch.yaw;
  }

  set yaw(value: number) {
    // Read before placing: `position` returns the shared scratch transform,
    // which `place` overwrites.
    simWorld.state.transform(this.sim.id, scratch);
    this.place(scratch.x, scratch.z, value);
  }

  get position() {
    simWorld.state.transform(this.sim.id, scratch);
    return scratch;
  }

  place(x: number, z: number, yaw?: number) {
    this.sim.place(simWorld, x, z, yaw);
    this.syncFromSim();
  }

  update(dt: number, elapsed: number) {
    this.sim.update(simWorld, dt, readInput());
    this.syncFromSim();

    // Presentation only: a run bob derived from simulated speed.
    this.visual.setLocalPosition(
      0,
      Math.abs(Math.sin(elapsed * 7)) * Math.min(.12, Math.abs(this.sim.speed) * .012),
      0
    );

    if (this.sim.breathed) {
      const origin = this.root.getPosition().clone()
        .add(new pc.Vec3(0, 2, 0))
        .add(new pc.Vec3(this.sim.forwardX, 0, this.sim.forwardZ).mulScalar(2.8));
      const forward = new pc.Vec3(this.sim.forwardX, 0, this.sim.forwardZ);
      emitBreath(origin, forward);
      if (sceneName === 'forest') hitDwarves(this.root.getPosition(), forward);
    }
  }

  /** Copy the simulated transform onto the rendered entity. */
  private syncFromSim() {
    simWorld.state.transform(this.sim.id, scratch);
    this.root.setPosition(scratch.x, scratch.y, scratch.z);
    this.root.setEulerAngles(0, scratch.yaw, 0);
  }

  getVisualForwardAlignment() {
    if (!this.headNode || !this.tailNode) return null;
    const visualForward = this.headNode.getPosition().clone().sub(this.tailNode.getPosition());
    visualForward.y = 0;
    if (visualForward.lengthSq() < .001) return null;
    visualForward.normalize();
    const yawRadians = this.yaw * pc.math.DEG_TO_RAD;
    const gameplayForward = new pc.Vec3(-Math.sin(yawRadians), 0, -Math.cos(yawRadians));
    return visualForward.dot(gameplayForward);
  }

  private async loadRealModel() {
    try {
      const [containerAsset, baseColorAsset, emissiveAsset, normalAsset] = await Promise.all([
        loadAsset('/assets/wyvern/wyvern.glb', 'container'),
        loadAsset('/assets/wyvern/wyvern_base.webp', 'texture'),
        loadAsset('/assets/wyvern/wyvern_emissive.webp', 'texture'),
        loadAsset('/assets/wyvern/wyvern_normal.webp', 'texture')
      ]);
      const container = containerAsset.resource as pc.ContainerResource;
      const model = container.instantiateRenderEntity({ castShadows: true });
      model.name = 'Actual Fire Drake';
      model.setLocalScale(TUNING.drake.modelScale, TUNING.drake.modelScale, TUNING.drake.modelScale);
      model.setLocalEulerAngles(
        TUNING.drake.modelRotation.x,
        TUNING.drake.modelRotation.y,
        TUNING.drake.modelRotation.z
      );
      model.setLocalPosition(
        TUNING.drake.modelOffset.x,
        TUNING.drake.modelOffset.y,
        TUNING.drake.modelOffset.z
      );

      const dragonMaterial = new pc.StandardMaterial();
      dragonMaterial.diffuseMap = baseColorAsset.resource as pc.Texture;
      dragonMaterial.normalMap = normalAsset.resource as pc.Texture;
      dragonMaterial.emissiveMap = emissiveAsset.resource as pc.Texture;
      dragonMaterial.emissive = pc.Color.WHITE;
      dragonMaterial.emissiveIntensity = 1.6;
      dragonMaterial.metalness = 0;
      dragonMaterial.gloss = 28;
      dragonMaterial.cull = pc.CULLFACE_NONE;
      dragonMaterial.update();

      for (const render of model.findComponents('render') as pc.RenderComponent[]) {
        for (const meshInstance of render.meshInstances) meshInstance.material = dragonMaterial;
      }
      this.headNode = model.findByName('head_021');
      this.tailNode = model.findByName('tip_013');
      this.visual.addChild(model);
      this.placeholder.enabled = false;
      this.modelReady = true;
      objective.textContent = sceneName === 'cave'
        ? 'Rampage toward the forest gate'
        : sceneName === 'forestExtract'
          ? 'Explore the extracted Unreal forest sector'
          : 'Cause some medieval mayhem';
    } catch (error) {
      console.error('The real Fire Drake model could not be loaded', error);
      objective.textContent = 'Fire Drake asset failed to load — check the console';
    }
  }
}

class Dwarf {
  readonly root = new pc.Entity('Dwarf');
  private leftArm: pc.Entity;
  private rightArm: pc.Entity;
  private flames: pc.Entity[] = [];
  private target = new pc.Vec3();
  private retarget = 0;
  private burning = 0;
  dead = false;

  constructor(position: pc.Vec3) {
    makePrimitive('Body', 'capsule', this.root, new pc.Vec3(0, 1.05, 0), new pc.Vec3(.62, .82, .62), mats.dwarf);
    makePrimitive('Head', 'sphere', this.root, new pc.Vec3(0, 2.05, 0), new pc.Vec3(.7, .7, .7), mats.skin);
    makePrimitive('Beard', 'cone', this.root, new pc.Vec3(0, 1.72, -.42), new pc.Vec3(.48, .82, .48), mats.gold);
    this.leftArm = makePrimitive('Left arm', 'capsule', this.root, new pc.Vec3(-.75, 1.18, 0), new pc.Vec3(.24, .72, .24), mats.skin, new pc.Vec3(0, 0, -15));
    this.rightArm = makePrimitive('Right arm', 'capsule', this.root, new pc.Vec3(.75, 1.18, 0), new pc.Vec3(.24, .72, .24), mats.skin, new pc.Vec3(0, 0, 15));
    world.addChild(this.root);
    this.root.setPosition(position);
    this.chooseTarget();
  }

  ignite() {
    if (this.burning > 0) return;
    this.burning = 5;
    for (let i = 0; i < 7; i++) {
      this.flames.push(makePrimitive(
        `Attached fire ${i}`, 'sphere', this.root,
        new pc.Vec3((Math.random() - .5) * 1.2, .45 + Math.random() * 1.9, (Math.random() - .5) * .8),
        new pc.Vec3(.18, .4, .18), mats.fire
      ));
    }
  }

  update(dt: number, elapsed: number) {
    if (this.dead) return;
    this.retarget -= dt;
    if (this.retarget <= 0 || this.root.getPosition().distance(this.target) < 1.2) this.chooseTarget();
    const delta = this.target.clone().sub(this.root.getPosition());
    delta.y = 0;
    if (delta.lengthSq() > .01) {
      delta.normalize();
      this.root.translate(delta.x * dt * (this.burning ? 4.3 : 2.4), 0, delta.z * dt * (this.burning ? 4.3 : 2.4));
      this.root.lookAt(this.root.getPosition().clone().add(delta));
    }

    const run = Math.sin(elapsed * (this.burning ? 15 : 9));
    this.root.setLocalPosition(this.root.getLocalPosition().x, Math.abs(run) * .08, this.root.getLocalPosition().z);
    const flail = this.burning ? Math.sin(elapsed * 23) * 105 : run * 28;
    this.leftArm.setLocalEulerAngles(flail, 0, -20);
    this.rightArm.setLocalEulerAngles(-flail * .8, 0, 20);

    if (this.burning > 0) {
      this.burning -= dt;
      this.flames.forEach((flame, i) => {
        const flicker = .65 + Math.sin(elapsed * 18 + i) * .25;
        flame.setLocalScale(.18 * flicker, .48 * flicker, .18 * flicker);
      });
      if (this.burning <= 0) {
        this.dead = true;
        this.root.destroy();
      }
    }
  }

  private chooseTarget() {
    this.target.set((Math.random() - .5) * 76, 0, (Math.random() - .5) * 76);
    this.retarget = 2 + Math.random() * 4;
  }
}

const drake = new Drake();
const dwarves: Dwarf[] = [];
const breathParticles: { entity: pc.Entity; velocity: pc.Vec3; life: number }[] = [];
const keys = new Set<string>();
let sceneName: SceneName = previous?.scene ?? 'cave';
let elapsed = 0;
let spawnTimer = 0;
let transitioning = false;
let cameraYaw = previous?.yaw ?? 0;
let cameraPitch: number = TUNING.camera.pitchDegrees;
let cameraDistance: number = TUNING.camera.distance;
let targetCameraDistance: number = TUNING.camera.distance;
let pointerLockRequested = false;
let extractedObjects = 0;
let extractedSourceLevel: string | null = null;
let extractedLoadError: string | null = null;

window.addEventListener('keydown', (event) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  pointerLockRequested = true;
  void canvas.requestPointerLock().catch(error => {
    console.debug('Pointer lock unavailable; right-drag look remains active.', error);
  });
});
document.addEventListener('mousemove', event => {
  const isPointerLook = document.pointerLockElement === canvas;
  const isRightDrag = (event.buttons & 2) !== 0;
  if (!isPointerLook && !isRightDrag) return;
  cameraYaw -= event.movementX * TUNING.camera.mouseSensitivity;
  cameraPitch = pc.math.clamp(
    cameraPitch + event.movementY * TUNING.camera.mouseSensitivity,
    TUNING.camera.minPitch,
    TUNING.camera.maxPitch
  );
});
window.addEventListener('wheel', event => {
  targetCameraDistance = pc.math.clamp(
    targetCameraDistance + Math.sign(event.deltaY) * TUNING.camera.zoomStep,
    TUNING.camera.minDistance,
    TUNING.camera.maxDistance
  );
}, { passive: true });

function emitBreath(origin: pc.Vec3, forward: pc.Vec3) {
  const entity = makePrimitive('Fire breath', 'sphere', world, origin, new pc.Vec3(.18, .18, .42), mats.fire);
  const spread = new pc.Vec3((Math.random() - .5) * .32, (Math.random() - .25) * .18, (Math.random() - .5) * .32);
  breathParticles.push({ entity, velocity: forward.clone().add(spread).normalize().mulScalar(18 + Math.random() * 7), life: .55 });
}

function hitDwarves(origin: pc.Vec3, forward: pc.Vec3) {
  for (const dwarf of dwarves) {
    if (dwarf.dead) continue;
    const delta = dwarf.root.getPosition().clone().sub(origin);
    const distance = delta.length();
    if (distance < 11 && delta.normalize().dot(forward) > .78) dwarf.ignite();
  }
}

function clearWorld() {
  for (const child of [...world.children]) {
    if (child !== drake.root) child.destroy();
  }
  dwarves.length = 0;
  breathParticles.length = 0;
  extractedObjects = 0;
  extractedSourceLevel = null;
  extractedLoadError = null;
}

function buildCave() {
  clearWorld();
  sceneName = 'cave';
  camera.camera!.clearColor = new pc.Color(.055, .018, .009);
  app.scene.ambientLight = new pc.Color(.18, .055, .025);
  // The box primitive is a unit cube, so scale is the full extent: 116 spans
  // +/-58, which is what the movement clamp, portal, and spawns all assume.
  makePrimitive('Cave floor', 'box', world, new pc.Vec3(0, -.7, 0), new pc.Vec3(116, .7, 116), mats.rock);
  makePrimitive('Lava river', 'box', world, new pc.Vec3(0, -.18, 0), new pc.Vec3(8, .18, 116), mats.lava);
  for (let i = 0; i < 28; i++) {
    const side = i % 2 ? -1 : 1;
    makePrimitive('Cave rock', 'sphere', world,
      new pc.Vec3(side * (10 + Math.random() * 35), Math.random() * 3, (Math.random() - .5) * 100),
      new pc.Vec3(3 + Math.random() * 7, 4 + Math.random() * 8, 3 + Math.random() * 7), mats.rock);
  }
  makePrimitive('Portal left', 'box', world, new pc.Vec3(-5, 4, -43), new pc.Vec3(2, 6, 2), mats.rock);
  makePrimitive('Portal right', 'box', world, new pc.Vec3(5, 4, -43), new pc.Vec3(2, 6, 2), mats.rock);
  makePrimitive('Portal top', 'box', world, new pc.Vec3(0, 9, -43), new pc.Vec3(7, 2, 2), mats.rock);
  objective.textContent = 'Rampage toward the forest gate';
  drake.place(0, 13);
}

function buildForest() {
  clearWorld();
  sceneName = 'forest';
  camera.camera!.clearColor = new pc.Color(.36, .61, .76);
  app.scene.ambientLight = new pc.Color(.28, .34, .24);
  makePrimitive('Forest floor', 'box', world, new pc.Vec3(0, -.6, 0), new pc.Vec3(116, .6, 116), mats.grass);
  for (let i = 0; i < 75; i++) {
    const x = (Math.random() - .5) * 105;
    const z = (Math.random() - .5) * 105;
    if (Math.abs(x) < 9 && Math.abs(z) < 20) continue;
    const tree = new pc.Entity('Tree');
    world.addChild(tree);
    tree.setPosition(x, 0, z);
    makePrimitive('Trunk', 'cylinder', tree, new pc.Vec3(0, 2.4, 0), new pc.Vec3(.45, 2.4, .45), mats.bark);
    makePrimitive('Crown', 'cone', tree, new pc.Vec3(0, 6.3, 0), new pc.Vec3(2.4, 4.2, 2.4), i % 2 ? mats.leaf : mats.leaf2);
  }
  objective.textContent = 'Cause some medieval mayhem';
  drake.place(0, 38, 0);
  for (let i = 0; i < 6; i++) spawnDwarf();
}

function extractedMaterial(category: string) {
  if (category === 'tree') return mats.extractedTree;
  if (category === 'bush') return mats.extractedBush;
  if (category === 'flower') return mats.extractedFlower;
  if (category === 'mushroom') return mats.extractedMushroom;
  if (category === 'monument') return mats.extractedMonument;
  return mats.extractedStone;
}

async function buildExtractedForestSector() {
  clearWorld();
  sceneName = 'forestExtract';
  loading.classList.add('visible');
  camera.camera!.clearColor = new pc.Color(.36, .61, .76);
  app.scene.ambientLight = new pc.Color(.28, .34, .24);
  objective.textContent = 'Loading extracted Unreal forest sector…';
  stats.textContent = 'LOADING EXTRACTED SECTOR';

  try {
    const response = await fetch('/assets/forest-sector/forest-sector.json');
    if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
    const manifest = await response.json() as ForestManifest;
    extractedSourceLevel = manifest.source_level;
    const groundSize = manifest.sector.browser_ground_size_m;
    makePrimitive(
      'Extracted sector ground approximation',
      'box',
      world,
      new pc.Vec3(0, -.5, 0),
      // Full extent, not half: browser_ground_size_m is the span, and the box
      // primitive is a unit cube.
      new pc.Vec3(groundSize, .5, groundSize),
      mats.grass
    );

    const browserAssets = new Map<string, { definition: ForestAsset; container: pc.ContainerResource }>();
    await Promise.all(Object.entries(manifest.assets).map(async ([meshPath, definition]) => {
      if (!definition.exported) return;
      const asset = await loadAsset(definition.browser_glb, 'container');
      browserAssets.set(meshPath, {
        definition,
        container: asset.resource as pc.ContainerResource
      });
    }));

    for (const instance of manifest.instances) {
      const browserAsset = browserAssets.get(instance.mesh);
      if (!browserAsset) continue;
      const model = browserAsset.container.instantiateRenderEntity({ castShadows: true });
      model.name = `Extracted ${instance.name}`;
      model.setLocalPosition(...instance.position);
      model.setLocalEulerAngles(...instance.rotation);
      model.setLocalScale(
        instance.scale[0] * .01,
        instance.scale[1] * .01,
        instance.scale[2] * .01
      );
      for (const render of model.findComponents('render') as pc.RenderComponent[]) {
        if (render.entity.name.startsWith('UCX_')) {
          render.entity.enabled = false;
          continue;
        }
        for (const meshInstance of render.meshInstances) {
          meshInstance.material = extractedMaterial(browserAsset.definition.category);
        }
      }
      world.addChild(model);
      extractedObjects++;
    }

    drake.place(0, 0, 0);
    objective.textContent = 'Explore the extracted Unreal forest sector';
  } catch (error) {
    extractedLoadError = error instanceof Error ? error.message : String(error);
    console.error('The extracted Unreal forest sector could not be loaded', error);
    objective.textContent = 'Extracted forest failed to load — check the console';
  } finally {
    loading.classList.remove('visible');
  }
}

function spawnDwarf() {
  if (dwarves.filter(dwarf => !dwarf.dead).length >= 12) return;
  dwarves.push(new Dwarf(new pc.Vec3((Math.random() - .5) * 70, 0, (Math.random() - .5) * 60)));
}

async function transitionToForest() {
  if (transitioning) return;
  transitioning = true;
  loading.classList.add('visible');
  await new Promise(resolve => setTimeout(resolve, 700));
  buildForest();
  await new Promise(resolve => setTimeout(resolve, 350));
  loading.classList.remove('visible');
  transitioning = false;
}

const requestedLevel = new URLSearchParams(window.location.search).get('level');
if (requestedLevel === 'extracted') void buildExtractedForestSector();
else if (sceneName === 'forest') buildForest();
else buildCave();

window.__FIRE_DRAKE_DEBUG__ = {
  getState: () => {
    const drakePosition = drake.root.getPosition();
    const cameraPosition = camera.getPosition();
    return {
      scene: sceneName,
      modelReady: drake.modelReady,
      pointerLocked: document.pointerLockElement === canvas,
      pointerLockRequested,
      drake: {
        x: drakePosition.x,
        y: drakePosition.y,
        z: drakePosition.z,
        yaw: drake.yaw
      },
      camera: {
        x: cameraPosition.x,
        y: cameraPosition.y,
        z: cameraPosition.z,
        yaw: cameraYaw,
        pitch: cameraPitch,
        distance: cameraDistance,
        targetDistance: targetCameraDistance
      },
      model: {
        scale: TUNING.drake.modelScale,
        rotation: { ...TUNING.drake.modelRotation },
        offset: { ...TUNING.drake.modelOffset },
        forwardAlignment: drake.getVisualForwardAlignment()
      },
      effects: {
        breathParticles: breathParticles.length,
        activeDwarves: dwarves.filter(dwarf => !dwarf.dead).length
      },
      extracted: {
        objects: extractedObjects,
        sourceLevel: extractedSourceLevel,
        loadError: extractedLoadError
      }
    };
  },
  teleport: (x: number, z: number) => drake.place(x, z),
  loadScene: (name: SceneName) => {
    if (name === 'forestExtract') void buildExtractedForestSector();
    else if (name === 'forest') buildForest();
    else buildCave();
  },
  resetCamera: () => {
    cameraYaw = drake.yaw;
    cameraPitch = TUNING.camera.pitchDegrees;
    cameraDistance = TUNING.camera.distance;
    targetCameraDistance = TUNING.camera.distance;
  }
};

app.on('update', (dt: number) => {
  elapsed += dt;
  drake.update(dt, elapsed);

  const drakePosition = drake.root.getPosition();
  cameraDistance = pc.math.lerp(cameraDistance, targetCameraDistance, Math.min(1, dt * 12));
  const cameraYawRadians = cameraYaw * pc.math.DEG_TO_RAD;
  const pitch = cameraPitch * pc.math.DEG_TO_RAD;
  const horizontalDistance = Math.cos(pitch) * cameraDistance;
  const desiredCamera = drakePosition.clone().add(new pc.Vec3(
    Math.sin(cameraYawRadians) * horizontalDistance,
    TUNING.camera.targetHeight + Math.sin(pitch) * cameraDistance,
    Math.cos(cameraYawRadians) * horizontalDistance
  ));
  camera.setPosition(camera.getPosition().lerp(
    camera.getPosition(),
    desiredCamera,
    Math.min(1, dt * TUNING.camera.followResponsiveness)
  ));
  const facing = new pc.Vec3(-Math.sin(drake.yaw * pc.math.DEG_TO_RAD), 0, -Math.cos(drake.yaw * pc.math.DEG_TO_RAD));
  camera.lookAt(
    drakePosition.clone()
      .add(new pc.Vec3(0, TUNING.camera.targetHeight, 0))
      .add(facing.mulScalar(TUNING.camera.lookAhead))
  );

  for (let i = breathParticles.length - 1; i >= 0; i--) {
    const particle = breathParticles[i];
    particle.life -= dt;
    particle.entity.translate(particle.velocity.x * dt, particle.velocity.y * dt, particle.velocity.z * dt);
    const scale = Math.max(.05, particle.life * 1.3);
    particle.entity.setLocalScale(scale, scale, scale * 2);
    if (particle.life <= 0) {
      particle.entity.destroy();
      breathParticles.splice(i, 1);
    }
  }

  dwarves.forEach(dwarf => dwarf.update(dt, elapsed));
  if (sceneName === 'forest') {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = 2.5;
      spawnDwarf();
    }
  } else if (drakePosition.z < -38) {
    void transitionToForest();
  }

  stats.textContent = sceneName === 'forest'
    ? `${dwarves.filter(dwarf => !dwarf.dead).length} DWARVES · ${dwarves.filter(dwarf => !dwarf.dead && dwarf['burning'] > 0).length} BURNING`
    : sceneName === 'forestExtract'
      ? `${extractedObjects} EXTRACTED OBJECTS`
      : 'LAVA CAVE';
});

window.addEventListener('resize', () => app.resizeCanvas());

if (import.meta.hot) {
  import.meta.hot.dispose(data => {
    const position = drake.root.getPosition();
    data.state = { scene: sceneName, x: position.x, z: position.z, yaw: drake.yaw } satisfies SavedState;
    app.destroy();
  });
}
