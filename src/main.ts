/**
 * Fire Drake: a storybook rampage.
 *
 * Composition and the frame loop. The simulation (`src/sim/`) owns gameplay,
 * the view (`src/view/`) draws it, and `src/game/` holds the pieces that
 * connect them: camera, input, lighting, event presentation, the debug API.
 * This file builds them, switches chapters, and runs one frame at a time.
 */

import * as pc from 'playcanvas';
import './style.css';
import { TUNING } from './tuning';
import { World } from './sim/world';
import { DrakeSim } from './sim/drake';
import { Rng } from './sim/random';
import { Rampage, type RampageEvent } from './sim/rampage';
import { spawnFor } from './sim/level';
import { getLevel } from './sim/levels';
import { initPaper } from './view/paper';
import { prewarmVillage, Stage } from './view/stage';
import { Fx } from './view/fx';
import { Puppet } from './view/puppet';
import { DrakeView } from './view/drake';
import { PostStack } from './view/post';
import { Hud } from './view/hud';
import { Sound } from './view/audio';
import { isTouchDevice, TouchControls } from './view/touch';
import { Party } from './party';
import { startTelemetry } from './telemetry';
import { randomRoomCode } from './net/client';
import { cleanRoom } from './net/protocol';
import { CameraRig } from './game/camera';
import { Controls } from './game/input';
import { Lighting } from './game/lighting';
import { EventPresenter } from './game/presenter';
import { loadExtractedSector, type ExtractedSector } from './game/extracted';
import { installDebugApi, type SceneName } from './game/debug';
import { Desk } from './editor/desk';
import { validateLevel, type LevelDefinition } from './sim/level';
import { bindChapter, fetchChapter } from './net/chapters';
import { moodOf, type MoodPalette } from './view/moods';

type SavedState = { scene: SceneName; x: number; z: number; yaw: number };

// ── Platform ───────────────────────────────────────────────────────────────

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const params = new URLSearchParams(window.location.search);
const touch = isTouchDevice();
const stamp = document.querySelector('#cover-version');
if (stamp) stamp.textContent = `build ${__BUILD_VERSION__}${touch ? ' · touch' : ''}`;
// Automated runs and phones get the cheap pipeline: same game, fewer passes.
const quality = (params.get('quality') ?? (navigator.webdriver || touch ? 'low' : 'high')) as 'high' | 'low';
const SERVER_URL = params.get('server') ?? 'wss://firedrakegame-playcanvas.fly.dev/ws';
const telemetry = startTelemetry(SERVER_URL, __BUILD_VERSION__, params);
telemetry.note({ quality, touch });

const previous = import.meta.hot?.data.state as SavedState | undefined;
const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: false, alpha: false } });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
// Phones get a little more than 1x: their screens are small and dense, and
// 1x reads as blurry; 2x costs a phone GPU too much fill for the post chain.
app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, quality === 'high' ? 2 : touch ? 1.5 : 1);
app.start();
initPaper(app.graphicsDevice);
window.addEventListener('resize', () => app.resizeCanvas());

// ── Simulation ─────────────────────────────────────────────────────────────

const simWorld = new World();
const simRng = new Rng(0xf13d2a4e);
const drakeSim = new DrakeSim(simWorld, previous?.x ?? 0, previous?.z ?? 13, previous?.yaw ?? 0);
let rampage = new Rampage(simWorld, simRng, drakeSim, undefined, false);

// ── View ───────────────────────────────────────────────────────────────────

const world = new pc.Entity('World');
app.root.addChild(world);
const camera = new pc.Entity('Camera');
camera.addComponent('camera', { clearColor: new pc.Color(.06, .08, .05), nearClip: .15, farClip: 700, fov: TUNING.camera.fov });
app.root.addChild(camera);
const post = new PostStack(app, camera.camera!, quality);
const lighting = new Lighting(app, camera, post, quality);
const rig = new CameraRig(camera, previous?.yaw ?? 0);
const fx = new Fx(world, quality === 'high' ? 8 : touch ? 3 : 4);
const hud = new Hud();
const sound = new Sound();
const drake = new DrakeView(app, drakeSim, world);
let stage = new Stage(world);
const puppets = new Map<number, Puppet>();
const presenter = new EventPresenter(hud, sound, fx, drake, rig, () => drakeSim.speed);

let sceneName: SceneName = previous?.scene ?? 'cave';
let transitioning = false;
let elapsed = 0;
/** The multiplayer session, when playing together. Null in single player. */
let party: Party | null = null;
const extracted: ExtractedSector = { objects: 0, sourceLevel: null, loadError: null };
/** The level chapter two plays alone: the default, or a draft being read. */
let currentLevel: LevelDefinition = getLevel();
/** True while reading a draft from the desk: B goes back to it. */
let readingDraft = false;
/** The chapter's mood, for weather in the frame loop. */
let mood: MoodPalette = moodOf(undefined);
let desk: Desk | null = null;
const draftBanner = document.createElement('button');
draftBanner.className = 'draft-banner hidden';
draftBanner.innerHTML = 'Reading your draft · <kbd>B</kbd> back to the desk';
draftBanner.addEventListener('click', () => backToDesk());
document.body.appendChild(draftBanner);
const events: RampageEvent[] = [];
const scratch = new pc.Vec3();
const mouth = new pc.Vec3();
const previousDrake = new pc.Vec3();

hud.deeds.onComplete = (deed, remaining) => {
  sound.fanfare();
  hud.pop(`✗ ${deed}`, scratch.copy(drake.root.getPosition()).add(new pc.Vec3(0, 3.6, 0)), 'deed', 2.2);
  if (remaining === 0) setTimeout(() => hud.showTheEnd(rampage.score), 2200);
};

// ── Input ──────────────────────────────────────────────────────────────────

const toggleMute = () => {
  const muted = sound.toggleMute();
  hud.pop(muted ? 'shh.' : '♪', scratch.copy(drake.root.getPosition()).add(new pc.Vec3(0, 3, 0)), 'shout', 1);
};

function restartChapter() {
  if (sceneName !== 'forest' || transitioning) return;
  sound.pageTurn();
  // Together, the room restarts for everyone; the server says when.
  if (party) party.session.requestRestart();
  else buildForest();
}

const controls = new Controls(canvas, rig, { KeyM: toggleMute, KeyR: restartChapter, KeyB: () => backToDesk() });

/**
 * Touch controls exist only on touch devices; the keyboard path is untouched.
 * Detection at load can be wrong (some phones report a fine pointer, some
 * embeds report none), so the first real touch also switches them on.
 */
function enableTouch() {
  if (controls.touch) return;
  telemetry.note({ touch: true, touchLate: !touch });
  controls.touch = new TouchControls(() => hud.openCover(), { mute: toggleMute, restart: restartChapter });
  // A phone discovered late still gets the phone pipeline.
  if (!params.get('quality')) {
    post.setQuality('low');
    app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, 1.5);
  }
}
if (touch) enableTouch();
else window.addEventListener('touchstart', () => enableTouch(), { once: true, passive: true });

// ── Chapters ───────────────────────────────────────────────────────────────

function clearWorld() {
  rampage.destroy();
  for (const puppet of puppets.values()) puppet.root.destroy();
  puppets.clear();
  stage.destroy();
  stage = new Stage(world);
  fx.clear();
  extracted.objects = 0;
  extracted.sourceLevel = null;
  extracted.loadError = null;
}

function buildCave() {
  clearWorld();
  sceneName = 'cave';
  mood = moodOf(undefined);
  lighting.cave();
  rampage = new Rampage(simWorld, simRng, drakeSim, undefined, false);
  stage.buildCave();
  drakeSim.place(simWorld, 0, 13, 0);
  hud.setChapter('Chapter the First', 'In Which a Drake Grows Bored of Gold');
  hud.setMayhemVisible(false);
  hud.narrate('intro', true);
}

function buildForest(draft?: LevelDefinition) {
  if (draft) currentLevel = draft;
  clearWorld();
  sceneName = 'forest';
  telemetry.note({ scene: 'forest', together: party !== null });
  // Together, the room decides the level; alone, it is the default or a draft.
  const level = party
    ? (party.session.chapter ? validateLevel(party.session.chapter) : getLevel(party.session.level || undefined))
    : currentLevel;
  mood = moodOf(level.mood);
  lighting.village(mood);
  // Together, this is a replica of the server's village: same props from the
  // same level, dwarves by snapshot, the local drake predicted.
  rampage = new Rampage(simWorld, simRng, drakeSim, level, true, party !== null);
  stage.buildVillage(level, rampage.props);
  const start = spawnFor(level, party ? Math.max(0, party.seat) : 0);
  drakeSim.place(simWorld, start.x, start.z, start.yaw);
  rig.yaw = start.yaw;
  party?.onRebuilt();
  hud.setChapter('Chapter the Second', level.heading || `In Which ${level.title} Has a Very Bad Day`);
  hud.resetRun(level.deeds, level.narration?.ending);
  hud.setMayhemVisible(true);
  if (level.narration?.opening) hud.narrateText(level.narration.opening);
  else hud.narrate('village', true);
}

async function buildExtractedForestSector() {
  clearWorld();
  sceneName = 'forestExtract';
  mood = moodOf(undefined);
  lighting.village(mood);
  hud.setChapter('An Appendix', 'The Extracted Unreal Forest Sector');
  hud.setMayhemVisible(false);
  hud.setLoading(true, 'Consulting the archives…');
  rampage = new Rampage(simWorld, simRng, drakeSim, undefined, false);
  await loadExtractedSector(app, stage.root, extracted);
  if (!extracted.loadError) drakeSim.place(simWorld, 0, 0, 0);
  hud.setLoading(false);
}

// ── The author's desk ──────────────────────────────────────────────────────

/** The draft page, drawn as it will play, with nobody home yet. */
function buildDeskPage(level: LevelDefinition) {
  clearWorld();
  sceneName = 'desk';
  mood = moodOf(level.mood);
  lighting.village(mood);
  rampage = new Rampage(simWorld, simRng, drakeSim, level, false, true);
  stage.buildVillage(level, rampage.props);
  const start = spawnFor(level, 0);
  drakeSim.place(simWorld, start.x, start.z, start.yaw);
}

function openDesk(level?: LevelDefinition, resume = false) {
  if (party) {
    party.destroy();
    party = null;
  }
  hud.openCover();
  readingDraft = false;
  draftBanner.classList.add('hidden');
  desk ??= new Desk({
    camera,
    rig,
    controls,
    build: buildDeskPage,
    propRoot: index => stage.props[index]?.root ?? null,
    read: draft => {
      desk!.close();
      readingDraft = true;
      draftBanner.classList.remove('hidden');
      buildForest(draft);
      // The desk's high view is no way to play: back behind the drake.
      rig.reset(spawnFor(draft, 0).yaw);
      hud.setChapter(`Your Draft: ${draft.title}`, draft.heading || `In Which ${draft.title} Has a Very Bad Day`);
    },
    close: () => {
      desk!.close();
      currentLevel = getLevel();
      buildCave();
    },
    bind: draft => bindChapter(SERVER_URL, draft)
  }, app);
  desk.open(level, resume);
}

function backToDesk() {
  if (!readingDraft || !desk) return;
  currentLevel = getLevel();
  openDesk(undefined, true);
}

function loadScene(name: SceneName) {
  if (name === 'desk') return openDesk();
  if (desk?.isOpen) desk.close();
  readingDraft = false;
  draftBanner.classList.add('hidden');
  if (name === 'forestExtract') void buildExtractedForestSector();
  else if (name === 'forest') buildForest();
  else buildCave();
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

// ── Together ───────────────────────────────────────────────────────────────

/** Join (or open) a room. The cave is skipped: together, you start in the village. */
function startParty(roomCode: string, name: string, chapterCode = '') {
  if (party) party.destroy();
  const room = cleanRoom(roomCode);
  try {
    localStorage.setItem('fire-drake:name', name);
  } catch {
    // Private mode: the name just is not remembered.
  }
  hud.setLoading(true, `Room ${room}`);
  party = new Party({
    app,
    world,
    simWorld,
    drake: drakeSim,
    drakeView: drake,
    fx,
    camera,
    rampage: () => rampage,
    rebuild: () => {
      buildForest();
      hud.setLoading(false);
      hud.setChapter('Chapter the Second, Together', 'In Which Little Kindling Has Several Very Bad Days');
    },
    events: incoming => events.push(...incoming),
    status: (status, detail) => {
      if (status === 'open' || status === 'connecting') return;
      hud.setLoading(false);
      hud.narrateText(detail);
    }
  }, SERVER_URL, room, name, chapterCode.trim().toLowerCase());
}

/** Read a bound chapter alone: fetch it, check it, play it. */
async function readBoundChapter(code: string) {
  const error = document.querySelector<HTMLDivElement>('#read-error');
  if (error) error.textContent = '';
  hud.setLoading(true, 'Fetching the chapter…');
  const result = await fetchChapter(SERVER_URL, code);
  if (!result.ok) {
    hud.setLoading(false);
    if (error) error.textContent = result.error;
    return false;
  }
  hud.openCover();
  sound.pageTurn();
  buildForest(result.level);
  rig.reset(spawnFor(result.level, 0).yaw);
  await new Promise(resolve => setTimeout(resolve, 300));
  hud.setLoading(false);
  return true;
}

document.querySelector<HTMLFormElement>('#read-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const code = document.querySelector<HTMLInputElement>('#read-code')!.value;
  (document.activeElement as HTMLElement | null)?.blur();
  void readBoundChapter(code);
});

document.querySelector<HTMLFormElement>('#together-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const room = document.querySelector<HTMLInputElement>('#together-room')!.value;
  const name = document.querySelector<HTMLInputElement>('#together-name')!.value.trim();
  const chapter = document.querySelector<HTMLInputElement>('#together-chapter')!.value;
  (document.activeElement as HTMLElement | null)?.blur();
  hud.openCover();
  sound.pageTurn();
  startParty(room, name, chapter);
});
{
  const roomInput = document.querySelector<HTMLInputElement>('#together-room');
  const nameInput = document.querySelector<HTMLInputElement>('#together-name');
  if (roomInput) roomInput.value = params.get('room') ?? randomRoomCode();
  if (nameInput) {
    try {
      nameInput.value = localStorage.getItem('fire-drake:name') ?? '';
    } catch {
      // No storage, no remembered name.
    }
  }
}

// ── Start ──────────────────────────────────────────────────────────────────

if (params.get('level') === 'extracted') void buildExtractedForestSector();
else if (sceneName === 'forest') buildForest();
else {
  buildCave();
  // Draw chapter two's paper while the reader is still on the cover.
  setTimeout(() => void prewarmVillage(getLevel()), 400);
}

installDebugApi({
  scene: () => sceneName,
  loadScene,
  rampage: () => rampage,
  stage: () => stage,
  party: () => party,
  extracted: () => extracted,
  simWorld,
  drakeSim,
  drake,
  camera,
  rig,
  controls,
  fx,
  desk: () => desk
});

document.querySelector('#write-chapter')?.addEventListener('click', event => {
  event.preventDefault();
  openDesk();
});

/**
 * Lift the inline boot screen once the drake is in and the book's fonts have
 * loaded, so the first thing a reader sees is the styled cover rather than a
 * flash of plain text. Fonts get a short grace period, not a veto: offline,
 * the Georgia fallback is better than waiting forever.
 */
let booted = false;
const fontsReady = Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2500))]);
function finishBoot() {
  if (booted) return;
  booted = true;
  void fontsReady.then(() => {
    document.body.classList.add('ready');
    const boot = document.querySelector<HTMLDivElement>('#boot');
    if (!boot) return;
    boot.classList.add('done');
    setTimeout(() => boot.remove(), 800);
    // A direct link to a room skips the cover and joins; ?desk opens the desk.
    const room = params.get('room');
    if (room && !party) {
      hud.openCover();
      startParty(room, params.get('name') ?? '', params.get('chapter') ?? '');
    } else if (params.get('chapter')) {
      void readBoundChapter(params.get('chapter')!);
    } else if (params.has('desk')) {
      openDesk();
    }
  });
}

// ── Frame ──────────────────────────────────────────────────────────────────

const lookAt = new pc.Vec3();
const lookTransform = { x: 0, y: 0, z: 0, yaw: 0 };
/** The closest dwarf within `range` of the drake, for the head to watch. */
function nearestDwarfWithin(range: number): pc.Vec3 | null {
  const at = drake.root.getPosition();
  let best = range;
  let found = false;
  for (const dwarf of rampage.dwarves) {
    if (dwarf.dead || !simWorld.state.transform(dwarf.id, lookTransform)) continue;
    const distance = Math.hypot(lookTransform.x - at.x, lookTransform.z - at.z);
    if (distance < best) {
      best = distance;
      lookAt.set(lookTransform.x, lookTransform.y + 1, lookTransform.z);
      found = true;
    }
  }
  return found ? lookAt : null;
}

const drakeTransform = { x: 0, y: 0, z: 0, yaw: 0 };
const drakeYaw = () => {
  simWorld.state.transform(drakeSim.id, drakeTransform);
  return drakeTransform.yaw;
};

/** A frame at the desk: pan and pick, draw the page, no simulation. */
function deskFrame(frameDt: number) {
  controls.update();
  desk!.update(frameDt);
  drake.breathHeld = false;
  drake.lookTarget = null;
  drake.update(simWorld.state, frameDt, elapsed);
  const fires = stage.update(frameDt, elapsed, fx);
  if (mood.snow) fx.snowfall(camera, quality === 'high' ? 26 : 14, frameDt);
  fx.assignLights(fires);
  fx.update(frameDt, camera, elapsed);
  sound.update(0, false);
  rig.update(frameDt, elapsed, desk!.focus, rig.yaw, false);
  post.focusAt(camera.getPosition().distance(desk!.focus));
  telemetry.frame(frameDt);
}

app.on('update', (frameDt: number) => {
  elapsed += frameDt;
  if (!booted && (drake.modelReady || drake.loadError)) finishBoot();
  if (sceneName === 'desk' && desk?.isOpen) return deskFrame(frameDt);
  // Hit-stop: a few frames of near-freeze on a big impact sells the weight.
  const dt = presenter.timeScale(frameDt);

  controls.touch?.setVisible(!hud.isCoverShowing && !hud.isLoading);
  controls.update();

  // Simulate (or, together, predict) and draw the drake.
  previousDrake.copy(drake.root.getPosition());
  if (party) party.update(frameDt, elapsed, controls.read);
  else rampage.tick(dt, controls.read());
  drake.breathHeld = controls.breathingHeld;
  drake.lookTarget = nearestDwarfWithin(14);
  drake.update(simWorld.state, dt, elapsed);

  const breathing = drakeSim.breathed;
  if (breathing) {
    drake.mouthPosition(mouth);
    const forward = new pc.Vec3(drakeSim.forwardX, -.04, drakeSim.forwardZ);
    const velocity = drake.root.getPosition().clone().sub(previousDrake).mulScalar(1 / Math.max(dt, 1e-4));
    fx.breath(mouth, forward, velocity);
    rig.rumble(.06);
  }
  sound.breath(controls.breathingHeld);

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
  for (const event of events) presenter.present(event);
  events.length = 0;

  // Scenery, fire and its light.
  const fires = stage.update(dt, elapsed, fx, camera.getPosition(), drake.root.getPosition());
  for (const dwarf of rampage.dwarves) {
    const puppet = puppets.get(dwarf.id);
    if (dwarf.burning && puppet) fires.push({ position: puppet.root.getPosition(), strength: .5 });
  }
  if (breathing) fires.push({ position: mouth.clone(), strength: 1.2 });
  if (mood.snow && sceneName === 'forest') fx.snowfall(camera, quality === 'high' ? 26 : 14, dt);
  fx.assignLights(fires);
  fx.update(dt, camera, elapsed);
  sound.fires(fires.length);
  sound.update(rampage.combo, sceneName === 'cave');

  const drakePosition = drake.root.getPosition();
  rig.update(frameDt, elapsed, drakePosition, drakeYaw(), drakeSim.speed > TUNING.drake.walkSpeed + 1);
  post.focusAt(camera.getPosition().distance(drakePosition));

  if (sceneName === 'cave' && drakePosition.z < -38 && !party) void transitionToForest();
  if (sceneName === 'forest' && rampage.score >= 2100 && !hud.hasEnded) hud.showTheEnd(rampage.score);

  telemetry.frame(frameDt);
  hud.update(frameDt, camera.camera!, rampage.score, rampage.combo, controls.active);
  hud.setStats(sceneName === 'forest'
    ? `${rampage.livingDwarves} dwarves · ${rampage.burningDwarves} alight · best chain ×${rampage.bestCombo}`
    : sceneName === 'forestExtract'
      ? `${extracted.objects} extracted objects`
      : 'the hoard');
});

if (import.meta.hot) {
  import.meta.hot.dispose(data => {
    const position = drake.root.getPosition();
    data.state = { scene: sceneName, x: position.x, z: position.z, yaw: drakeYaw() } satisfies SavedState;
    app.destroy();
  });
}
