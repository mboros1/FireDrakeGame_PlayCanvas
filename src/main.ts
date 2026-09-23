/**
 * Fire Drake: a storybook rampage.
 *
 * Wiring only. The simulation (`src/sim/`) owns gameplay; the view
 * (`src/view/`) draws it; this file owns the application, input, camera,
 * scene loading, the frame loop and the `window.__FIRE_DRAKE_DEBUG__`
 * automation surface.
 */

import * as pc from 'playcanvas';
import './style.css';
import { TUNING } from './tuning';
import { World } from './sim/world';
import { DrakeSim } from './sim/drake';
import { Rng } from './sim/random';
import { Rampage, type RampageEvent } from './sim/rampage';
import { PropKind } from './sim/props';
import { buildVillageLayout } from './sim/village';
import type { Input } from './sim/types';
import { initPaper } from './view/paper';
import { Stage } from './view/stage';
import { Fx } from './view/fx';
import { Puppet } from './view/puppet';
import { DrakeView, loadAsset } from './view/drake';
import { GRADES, PostStack } from './view/post';
import { Hud } from './view/hud';
import { Sound } from './view/audio';

type SceneName = 'cave' | 'forest' | 'forestExtract';
type SavedState = { scene: SceneName; x: number; z: number; yaw: number };
type ForestAsset = { name: string; category: string; browser_glb: string; exported: boolean };
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
  sector: { browser_ground_size_m: number; player_start_position: [number, number, number]; radius_cm: number };
  assets: Record<string, ForestAsset>;
  instances: ForestInstance[];
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
const params = new URLSearchParams(window.location.search);
// Automated runs get the cheap pipeline: same game, fewer passes.
const quality = (params.get('quality') ?? (navigator.webdriver ? 'low' : 'high')) as 'high' | 'low';

const previous = import.meta.hot?.data.state as SavedState | undefined;
const app = new pc.Application(canvas, {
  graphicsDeviceOptions: { antialias: false, alpha: false }
});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1);
app.start();
initPaper(app.graphicsDevice);

const world = new pc.Entity('World');
app.root.addChild(world);

// ── Simulation ─────────────────────────────────────────────────────────────

const simWorld = new World();
const simRng = new Rng(0xf13d2a4e);
const drakeSim = new DrakeSim(simWorld, previous?.x ?? 0, previous?.z ?? 13, previous?.yaw ?? 0);
let rampage = new Rampage(simWorld, simRng, drakeSim, undefined, false);

// ── View ───────────────────────────────────────────────────────────────────

const camera = new pc.Entity('Camera');
camera.addComponent('camera', {
  clearColor: new pc.Color(.06, .08, .05),
  nearClip: .15,
  farClip: 700,
  fov: TUNING.camera.fov
});
app.root.addChild(camera);
const post = new PostStack(app, camera.camera!, quality);

const sun = new pc.Entity('Sun');
sun.addComponent('light', {
  type: 'directional',
  color: new pc.Color(1, .86, .66),
  intensity: 2.1,
  castShadows: true,
  shadowDistance: 70,
  shadowResolution: quality === 'high' ? 4096 : 2048,
  numCascades: quality === 'high' ? 2 : 1,
  shadowType: pc.SHADOW_PCF3_32F,
  shadowBias: .25,
  normalOffsetBias: .06
});
app.root.addChild(sun);

const fill = new pc.Entity('Sky fill');
fill.addComponent('light', { type: 'directional', color: new pc.Color(.55, .7, .95), intensity: .45, castShadows: false });
fill.setEulerAngles(-60, 200, 0);
app.root.addChild(fill);

const fx = new Fx(world, quality === 'high' ? 8 : 4);
const hud = new Hud();
const sound = new Sound();
const drake = new DrakeView(app, drakeSim, world);
let stage = new Stage(world);
const puppets = new Map<number, Puppet>();

const frameInput: Input = { forward: 0, right: 0, charging: false, breathing: false, cameraYaw: 0 };
const events: RampageEvent[] = [];
const keys = new Set<string>();
let sceneName: SceneName = previous?.scene ?? 'cave';
let elapsed = 0;
let transitioning = false;
let cameraYaw = previous?.yaw ?? 0;
let cameraPitch: number = TUNING.camera.pitchDegrees;
let cameraDistance: number = TUNING.camera.distance;
let targetCameraDistance: number = TUNING.camera.distance;
let pointerLockRequested = false;
let trauma = 0;
let fovKick = 0;
let hitStop = 0;
let extractedObjects = 0;
let extractedSourceLevel: string | null = null;
let extractedLoadError: string | null = null;
const cameraPosition = new pc.Vec3();
const scratch = new pc.Vec3();
const mouth = new pc.Vec3();
const previousDrake = new pc.Vec3();

const readInput = (): Input => {
  frameInput.forward =
    (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  frameInput.right =
    (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  frameInput.charging = keys.has('ShiftLeft') || keys.has('ShiftRight');
  frameInput.breathing = keys.has('Space');
  frameInput.cameraYaw = cameraYaw;
  return frameInput;
};

// ── Input ──────────────────────────────────────────────────────────────────

window.addEventListener('keydown', event => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  if (event.code === 'KeyM' && !event.repeat) {
    const muted = sound.toggleMute();
    hud.pop(muted ? 'shh.' : '♪', scratch.copy(drake.root.getPosition()).add(new pc.Vec3(0, 3, 0)), 'shout', 1);
  }
  keys.add(event.code);
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  pointerLockRequested = true;
  void canvas.requestPointerLock()?.catch(error => {
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

// ── Scenes ─────────────────────────────────────────────────────────────────

function clearWorld() {
  rampage.destroy();
  for (const puppet of puppets.values()) puppet.root.destroy();
  puppets.clear();
  stage.destroy();
  stage = new Stage(world);
  fx.clear();
  extractedObjects = 0;
  extractedSourceLevel = null;
  extractedLoadError = null;
}

function lightVillage() {
  camera.camera!.clearColor = new pc.Color(.96, .78, .6);
  app.scene.ambientLight = new pc.Color(.42, .4, .44);
  app.scene.fog.type = pc.FOG_LINEAR;
  app.scene.fog.color = new pc.Color(.93, .8, .68);
  app.scene.fog.start = 60;
  app.scene.fog.end = 230;
  sun.light!.color = new pc.Color(1, .84, .62);
  sun.light!.intensity = 2.3;
  sun.setEulerAngles(40, 30, 0);
  fill.light!.intensity = .5;
  post.apply(GRADES.village);
}

function lightCave() {
  camera.camera!.clearColor = new pc.Color(.07, .03, .05);
  app.scene.ambientLight = new pc.Color(.2, .1, .14);
  app.scene.fog.type = pc.FOG_LINEAR;
  app.scene.fog.color = new pc.Color(.13, .05, .08);
  app.scene.fog.start = 25;
  app.scene.fog.end = 110;
  sun.light!.color = new pc.Color(.85, .55, .75);
  sun.light!.intensity = .55;
  sun.setEulerAngles(62, 30, 0);
  fill.light!.intensity = .12;
  post.apply(GRADES.cave);
}

function buildCave() {
  clearWorld();
  sceneName = 'cave';
  lightCave();
  rampage = new Rampage(simWorld, simRng, drakeSim, undefined, false);
  stage.buildCave();
  drakeSim.place(simWorld, 0, 13, 0);
  hud.setChapter('Chapter the First', 'In Which a Drake Grows Bored of Gold');
  hud.setMayhemVisible(false);
  hud.narrate('intro', true);
}

function buildForest() {
  clearWorld();
  sceneName = 'forest';
  lightVillage();
  const layout = buildVillageLayout();
  rampage = new Rampage(simWorld, simRng, drakeSim, layout);
  stage.buildVillage(layout, rampage.props);
  drakeSim.place(simWorld, layout.drakeStart.x, layout.drakeStart.z, layout.drakeStart.yaw);
  hud.setChapter('Chapter the Second', 'In Which Little Kindling Has a Very Bad Day');
  hud.setMayhemVisible(true);
  hud.narrate('village', true);
}

async function buildExtractedForestSector() {
  clearWorld();
  sceneName = 'forestExtract';
  lightVillage();
  hud.setChapter('An Appendix', 'The Extracted Unreal Forest Sector');
  hud.setMayhemVisible(false);
  hud.setLoading(true, 'Consulting the archives…');
  rampage = new Rampage(simWorld, simRng, drakeSim, undefined, false);
  const grass = new pc.StandardMaterial();
  grass.diffuse = new pc.Color(.12, .32, .09);
  grass.update();
  const categories: Record<string, pc.Color> = {
    tree: new pc.Color(.2, .43, .12),
    bush: new pc.Color(.28, .5, .13),
    flower: new pc.Color(.75, .22, .48),
    mushroom: new pc.Color(.72, .36, .12),
    monument: new pc.Color(.46, .39, .24)
  };
  const materials = new Map<string, pc.StandardMaterial>();
  const materialFor = (category: string) => {
    let m = materials.get(category);
    if (!m) {
      m = new pc.StandardMaterial();
      m.diffuse = categories[category] ?? new pc.Color(.29, .31, .27);
      m.update();
      materials.set(category, m);
    }
    return m;
  };
  try {
    const response = await fetch('/assets/forest-sector/forest-sector.json');
    if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
    const manifest = await response.json() as ForestManifest;
    extractedSourceLevel = manifest.source_level;
    const groundSize = manifest.sector.browser_ground_size_m;
    const ground = new pc.Entity('Extracted sector ground approximation');
    ground.addComponent('render', { type: 'box' });
    ground.render!.material = grass;
    ground.setLocalPosition(0, -.5, 0);
    // Full extent, not half: browser_ground_size_m is the span.
    ground.setLocalScale(groundSize, .5, groundSize);
    stage.root.addChild(ground);

    const browserAssets = new Map<string, { definition: ForestAsset; container: pc.ContainerResource }>();
    await Promise.all(Object.entries(manifest.assets).map(async ([meshPath, definition]) => {
      if (!definition.exported) return;
      const asset = await loadAsset(app, definition.browser_glb, 'container');
      browserAssets.set(meshPath, { definition, container: asset.resource as pc.ContainerResource });
    }));
    for (const instance of manifest.instances) {
      const browserAsset = browserAssets.get(instance.mesh);
      if (!browserAsset) continue;
      const model = browserAsset.container.instantiateRenderEntity({ castShadows: true });
      model.name = `Extracted ${instance.name}`;
      model.setLocalPosition(...instance.position);
      model.setLocalEulerAngles(...instance.rotation);
      model.setLocalScale(instance.scale[0] * .01, instance.scale[1] * .01, instance.scale[2] * .01);
      for (const render of model.findComponents('render') as pc.RenderComponent[]) {
        if (render.entity.name.startsWith('UCX_')) {
          render.entity.enabled = false;
          continue;
        }
        for (const meshInstance of render.meshInstances) meshInstance.material = materialFor(browserAsset.definition.category);
      }
      stage.root.addChild(model);
      extractedObjects++;
    }
    drakeSim.place(simWorld, 0, 0, 0);
  } catch (error) {
    extractedLoadError = error instanceof Error ? error.message : String(error);
    console.error('The extracted Unreal forest sector could not be loaded', error);
  } finally {
    hud.setLoading(false);
  }
}

async function transitionToForest() {
  if (transitioning) return;
  transitioning = true;
  sound.pageTurn();
  hud.setLoading(true, 'Chapter the Second');
  await new Promise(resolve => setTimeout(resolve, 900));
  buildForest();
  await new Promise(resolve => setTimeout(resolve, 450));
  hud.setLoading(false);
  transitioning = false;
}

const requestedLevel = params.get('level');
if (requestedLevel === 'extracted') void buildExtractedForestSector();
else if (sceneName === 'forest') buildForest();
else buildCave();

// ── Events: the simulation told us something happened ──────────────────────

function handleEvent(event: RampageEvent) {
  scratch.set(event.x, 0, event.z);
  const near = Math.max(0, 1 - scratch.distance(drake.root.getPosition()) / 30);
  hud.handle(event, scratch);
  switch (event.type) {
    case 'dwarfIgnited':
      sound.yelp();
      trauma = Math.min(1, trauma + .08 * near);
      break;
    case 'dwarfLaunched':
      sound.boing();
      fx.burst(scratch.clone().add(new pc.Vec3(0, .6, 0)), 14);
      trauma = Math.min(1, trauma + .35);
      hitStop = .06;
      if (Math.random() < .6) setTimeout(() => sound.yelp(), 120);
      break;
    case 'dwarfLanded':
      sound.thump(.25 * near + .05);
      fx.burst(scratch, 4, false);
      break;
    case 'dwarfGone':
      fx.ghost(scratch);
      break;
    case 'propIgnited':
      if (event.kind === PropKind.Cottage || event.kind === PropKind.Maypole) {
        sound.whoomp();
        trauma = Math.min(1, trauma + .3 * near);
      }
      break;
    case 'propFlattened':
      sound.crumple(event.kind === PropKind.Cottage ? 1.6 : .7);
      fx.burst(scratch.clone().add(new pc.Vec3(0, .5, 0)), event.kind === PropKind.Cottage ? 30 : 10);
      trauma = Math.min(1, trauma + (event.kind === PropKind.Cottage ? .6 : .2));
      hitStop = event.kind === PropKind.Cottage ? .1 : .04;
      break;
    case 'bump':
      if (drakeSim.speed > 4) trauma = Math.min(1, trauma + .1);
      break;
    default:
      break;
  }
  if ('combo' in event && event.combo > 0 && event.combo % 8 === 0) sound.fanfare();
}

// ── Debug surface. Must survive every refactor: tests and MCP depend on it ──

window.__FIRE_DRAKE_DEBUG__ = {
  getState: () => {
    const drakePosition = drake.root.getPosition();
    const cameraAt = camera.getPosition();
    return {
      scene: sceneName,
      modelReady: drake.modelReady,
      pointerLocked: document.pointerLockElement === canvas,
      pointerLockRequested,
      drake: { x: drakePosition.x, y: drakePosition.y, z: drakePosition.z, yaw: drakeYaw() },
      camera: {
        x: cameraAt.x,
        y: cameraAt.y,
        z: cameraAt.z,
        yaw: cameraYaw,
        pitch: cameraPitch,
        distance: cameraDistance,
        targetDistance: targetCameraDistance
      },
      model: {
        scale: TUNING.drake.modelScale,
        rotation: { ...TUNING.drake.modelRotation },
        offset: { ...TUNING.drake.modelOffset },
        forwardAlignment: drake.getVisualForwardAlignment(drakeYaw()),
        bounds: drake.bounds()
      },
      effects: {
        breathParticles: fx.countOf('breath'),
        activeDwarves: rampage.livingDwarves,
        burningProps: stage.props.filter(p => p.burning).length,
        particles: fx.count
      },
      mayhem: { score: rampage.score, combo: rampage.combo, bestCombo: rampage.bestCombo },
      extracted: { objects: extractedObjects, sourceLevel: extractedSourceLevel, loadError: extractedLoadError }
    };
  },
  teleport: (x: number, z: number) => {
    drakeSim.place(simWorld, x, z);
    drake.sync(simWorld.state);
  },
  loadScene: (name: SceneName) => {
    if (name === 'forestExtract') void buildExtractedForestSector();
    else if (name === 'forest') buildForest();
    else buildCave();
  },
  resetCamera: () => {
    cameraYaw = drakeYaw();
    cameraPitch = TUNING.camera.pitchDegrees;
    cameraDistance = TUNING.camera.distance;
    targetCameraDistance = TUNING.camera.distance;
  }
};

function drakeYaw() {
  const t = { x: 0, y: 0, z: 0, yaw: 0 };
  simWorld.state.transform(drakeSim.id, t);
  return t.yaw;
}

// ── Frame ──────────────────────────────────────────────────────────────────

app.on('update', (frameDt: number) => {
  elapsed += frameDt;
  // Hit-stop: a few frames of near-freeze on a big impact sells the weight.
  const dt = hitStop > 0 ? frameDt * .12 : frameDt;
  hitStop = Math.max(0, hitStop - frameDt);

  previousDrake.copy(drake.root.getPosition());
  rampage.tick(dt, readInput());
  drake.update(simWorld.state, dt, elapsed);

  // Breath presentation.
  const breathing = drakeSim.breathed;
  if (breathing) {
    drake.mouthPosition(mouth);
    const forward = new pc.Vec3(drakeSim.forwardX, -.04, drakeSim.forwardZ);
    const drakeVelocity = drake.root.getPosition().clone().sub(previousDrake).mulScalar(1 / Math.max(dt, 1e-4));
    fx.breath(mouth, forward, drakeVelocity);
    trauma = Math.max(trauma, .06);
  }
  sound.breath(keys.has('Space'));

  // Puppets appear and disappear with their simulated dwarves.
  const living = new Set<number>();
  for (const dwarf of rampage.dwarves) {
    if (dwarf.dead) continue;
    living.add(dwarf.id);
    let puppet = puppets.get(dwarf.id);
    if (!puppet) {
      puppet = new Puppet(dwarf, world);
      puppets.set(dwarf.id, puppet);
    }
    puppet.update(simWorld.state, dt, elapsed, camera, fx);
  }
  for (const [id, puppet] of puppets) {
    if (!living.has(id)) {
      puppet.root.destroy();
      puppets.delete(id);
    }
  }

  rampage.drainEvents(events);
  for (const event of events) handleEvent(event);
  events.length = 0;

  const fires = stage.update(dt, elapsed, fx);
  for (const dwarf of rampage.dwarves) {
    if (dwarf.burning && puppets.has(dwarf.id)) fires.push({ position: puppets.get(dwarf.id)!.root.getPosition(), strength: .5 });
  }
  if (breathing) fires.push({ position: mouth.clone(), strength: 1.2 });
  fx.assignLights(fires);
  fx.update(dt, camera, elapsed);
  sound.fires(fires.length);
  sound.update(rampage.combo, sceneName === 'cave');

  // Camera: follow, zoom, charge kick, shake.
  const drakePosition = drake.root.getPosition();
  cameraDistance = pc.math.lerp(cameraDistance, targetCameraDistance, Math.min(1, frameDt * 12));
  const charging = drakeSim.speed > TUNING.drake.walkSpeed + 1;
  fovKick = pc.math.lerp(fovKick, charging ? 9 : 0, Math.min(1, frameDt * 4));
  camera.camera!.fov = TUNING.camera.fov + fovKick;
  const cameraYawRadians = cameraYaw * pc.math.DEG_TO_RAD;
  const pitch = cameraPitch * pc.math.DEG_TO_RAD;
  const distance = cameraDistance + fovKick * .12;
  const horizontalDistance = Math.cos(pitch) * distance;
  const desiredCamera = drakePosition.clone().add(new pc.Vec3(
    Math.sin(cameraYawRadians) * horizontalDistance,
    TUNING.camera.targetHeight + Math.sin(pitch) * distance,
    Math.cos(cameraYawRadians) * horizontalDistance
  ));
  cameraPosition.lerp(cameraPosition.lengthSq() === 0 ? desiredCamera : cameraPosition, desiredCamera, Math.min(1, frameDt * TUNING.camera.followResponsiveness));
  trauma = Math.max(0, trauma - frameDt * 1.6);
  const shake = trauma * trauma;
  camera.setPosition(
    cameraPosition.x + (Math.sin(elapsed * 47) + Math.sin(elapsed * 31)) * shake * .18,
    cameraPosition.y + (Math.sin(elapsed * 53) + Math.sin(elapsed * 23)) * shake * .14,
    cameraPosition.z + (Math.sin(elapsed * 41) + Math.sin(elapsed * 37)) * shake * .18
  );
  const facing = new pc.Vec3(-Math.sin(drakeYaw() * pc.math.DEG_TO_RAD), 0, -Math.cos(drakeYaw() * pc.math.DEG_TO_RAD));
  camera.lookAt(drakePosition.clone().add(new pc.Vec3(0, TUNING.camera.targetHeight, 0)).add(facing.mulScalar(TUNING.camera.lookAhead)));
  post.focusAt(camera.getPosition().distance(drakePosition));

  if (sceneName === 'cave' && drakePosition.z < -38) void transitionToForest();

  hud.update(frameDt, camera.camera!, rampage.score, rampage.combo, keys.size > 0);
  hud.setStats(sceneName === 'forest'
    ? `${rampage.livingDwarves} dwarves · ${rampage.burningDwarves} alight · best chain ×${rampage.bestCombo}`
    : sceneName === 'forestExtract'
      ? `${extractedObjects} extracted objects`
      : 'the hoard');
});

window.addEventListener('resize', () => app.resizeCanvas());

if (import.meta.hot) {
  import.meta.hot.dispose(data => {
    const position = drake.root.getPosition();
    data.state = { scene: sceneName, x: position.x, z: position.z, yaw: drakeYaw() } satisfies SavedState;
    app.destroy();
  });
}
