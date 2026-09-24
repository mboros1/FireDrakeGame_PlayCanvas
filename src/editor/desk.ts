/**
 * The author's desk: where chapters are written.
 *
 * The village is drawn from the draft exactly as it will play, seen from
 * above like a pop-up book open on a desk. A tray of paper cutouts places
 * props; quill tools draw paths and ponds; ribbon bookmarks mark where
 * drakes enter. Every committed edit is validated, autosaved, and undoable.
 *
 * The desk edits a {@link LevelDefinition} and asks its host to redraw the
 * page after each committed change. During a drag it moves the dragged
 * cutout directly, so dragging never waits on a rebuild.
 */

import * as pc from 'playcanvas';
import { CHAPTER_LIMITS, DEED_TEMPLATES, LEVEL_LIMITS, LevelError, MOODS, validateLevel, toLevelFile, type DeedSpec, type DeedTemplate, type LevelDefinition, type Mood, type PropPlacement } from '../sim/level';
import { DEFAULT_DEEDS, deedWording } from '../view/deeds';
import { MOOD_PALETTES } from '../view/moods';
import { PROP_SPECS, PropKind } from '../sim/props';
import { drawBookmark, drawQuillDot, drawSelectionRing, PALETTE } from '../view/art';
import { canvasTexture, centredQuadMesh, meshEntity, paintMaterial, quadMesh } from '../view/paper';
import type { CameraRig } from '../game/camera';
import type { Controls } from '../game/input';
import { TUNING } from '../tuning';
import { blankChapter, chapterJson, copyOfChapter, listDrafts, loadDraft, parseChapter, saveDraft } from './drafts';

export type DeskTool = 'select' | 'place' | 'path' | 'pond' | 'bookmark' | 'erase';

export type DeskHost = {
  camera: pc.Entity;
  rig: CameraRig;
  controls: Controls;
  /** Redraw the page from the draft. */
  build: (level: LevelDefinition) => void;
  /** The drawn cutout for prop `index`, for live dragging. */
  propRoot: (index: number) => pc.Entity | null;
  /** Play the draft. */
  read: (level: LevelDefinition) => void;
  /** Leave the desk. */
  close: () => void;
};

const KIND_ORDER: [PropKind, string][] = [
  [PropKind.Cottage, 'Cottage'],
  [PropKind.Tree, 'Tree'],
  [PropKind.Haystack, 'Haystack'],
  [PropKind.Stall, 'Stall'],
  [PropKind.Fence, 'Fence'],
  [PropKind.Signpost, 'Signpost'],
  [PropKind.Maypole, 'Maypole']
];

const HISTORY_LIMIT = 100;
const BOUND = LEVEL_LIMITS.bounds;
const PAN_SPEED = 34;

/** How close a click must land to pick a prop: its collider, or a sensible minimum. */
const pickRadius = (p: PropPlacement) =>
  Math.max(p.kind === PropKind.Tree ? 1.4 * p.size : PROP_SPECS[p.kind].radius * p.size, 1.1);

const facingCentre = (x: number, z: number) => Math.atan2(-x, -z) * pc.math.RAD_TO_DEG;
const round = (v: number, step = .01) => Math.round(v / step) * step;
const clampToPage = (v: number) => Math.max(-BOUND, Math.min(BOUND, v));

type Drag =
  | { kind: 'prop'; index: number; startX: number; startZ: number; offsetX: number; offsetZ: number; moved: boolean; screenX: number; screenY: number }
  | { kind: 'spawn'; index: number; moved: boolean; screenX: number; screenY: number }
  | { kind: 'path'; points: [number, number][] }
  | { kind: 'pond'; x: number; z: number; radius: number };

export class Desk {
  level: LevelDefinition = blankChapter();
  tool: DeskTool = 'select';
  placeKind: PropKind = PropKind.Cottage;
  selected: number | null = null;
  readonly focus = new pc.Vec3(0, 0, 6);
  isOpen = false;

  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];
  private problems: string[] = [];
  private drag: Drag | null = null;
  private hover: { x: number; z: number } | null = null;
  private saved = true;

  private readonly overlay = new pc.Entity('Desk overlay');
  private readonly selectRing: pc.Entity;
  private readonly hoverRing: pc.Entity;
  private bookmarks: pc.Entity[] = [];
  private quillDots: pc.Entity[] = [];
  private readonly bookmarkMaterials: pc.Material[];
  private readonly dotMaterial: pc.Material;

  private readonly root: HTMLDivElement;
  private readonly title: HTMLInputElement;
  private readonly drafts: HTMLSelectElement;
  private readonly notes: HTMLDivElement;
  private readonly inspector: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly fileInput: HTMLInputElement;

  private readonly details: HTMLElement;
  private readonly ray = { from: new pc.Vec3(), to: new pc.Vec3() };
  private readonly canvas: HTMLCanvasElement;

  constructor(private readonly host: DeskHost, app: pc.AppBase) {
    this.canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
    app.root.addChild(this.overlay);
    this.overlay.enabled = false;
    const ringMaterial = paintMaterial(canvasTexture(drawSelectionRing(PALETTE.berry), { softAlpha: true }), true);
    const hoverMaterial = paintMaterial(canvasTexture(drawSelectionRing('rgba(43,39,51,.55)'), { softAlpha: true }), true);
    this.selectRing = this.flatMarker(ringMaterial);
    this.hoverRing = this.flatMarker(hoverMaterial);
    this.bookmarkMaterials = [0, 1, 2, 3].map(seat => paintMaterial(canvasTexture(drawBookmark(seat)), true));
    this.dotMaterial = paintMaterial(canvasTexture(drawQuillDot(), { softAlpha: true }), true);

    this.root = document.createElement('div');
    this.root.id = 'desk';
    this.root.className = 'desk hidden';
    this.root.innerHTML = `
      <header class="desk-bar">
        <div class="desk-brand">The Author's Desk</div>
        <label class="desk-title">Chapter: <input id="desk-title" maxlength="80" spellcheck="false" /></label>
        <select id="desk-drafts" aria-label="Drafts"></select>
        <div class="desk-actions">
          <button data-action="new">New page</button>
          <button data-action="copy">Copy Little Kindling</button>
          <button data-action="export">Export</button>
          <button data-action="import">Import</button>
          <button data-action="undo" title="⌘Z">Undo</button>
          <button data-action="redo" title="⇧⌘Z">Redo</button>
          <button data-action="details">Chapter details</button>
          <button data-action="read" class="desk-read">Read this page ▸</button>
          <button data-action="close">Close the desk</button>
        </div>
      </header>
      <aside class="desk-notes" id="desk-notes"></aside>
      <section class="desk-details hidden" id="desk-details">
        <div class="details-title">Chapter details</div>
        <label class="details-field">Heading
          <input id="details-heading" maxlength="${CHAPTER_LIMITS.heading}" placeholder="In Which…" spellcheck="true" />
        </label>
        <div class="details-field">Mood
          <div class="details-moods">
            ${MOODS.map(m => `<button data-mood="${m}" style="--sky:${MOOD_PALETTES[m].sky[1][1]};--ground:${MOOD_PALETTES[m].ground.base}">${MOOD_NAMES[m]}</button>`).join('')}
          </div>
        </div>
        <label class="details-field">The narrator opens with
          <textarea id="details-opening" maxlength="${CHAPTER_LIMITS.narration}" rows="2" placeholder="Meanwhile, in the village…"></textarea>
        </label>
        <label class="details-field">…and The End page says
          <textarea id="details-ending" maxlength="${CHAPTER_LIMITS.narration}" rows="2" placeholder="of Little Kindling, and of this particular book."></textarea>
        </label>
        <div class="details-field">Deeds
          <ol class="details-deeds" id="details-deeds"></ol>
          <div class="details-deed-actions">
            <button data-deed-action="add">Add a deed</button>
            <button data-deed-action="usual">Use the usual deeds</button>
          </div>
        </div>
      </section>
      <aside class="desk-inspector hidden" id="desk-inspector"></aside>
      <div class="desk-status" id="desk-status"></div>
      <nav class="desk-tray" id="desk-tray">
        <button data-tool="select" data-key="1">Select</button>
        ${KIND_ORDER.map(([kind, label], i) => `<button data-tool="place" data-kind="${kind}" data-key="${i + 2}">${label}</button>`).join('')}
        <span class="desk-tray-rule"></span>
        <button data-tool="path" data-key="P">Path</button>
        <button data-tool="pond" data-key="O">Pond</button>
        <button data-tool="bookmark" data-key="K">Bookmark</button>
        <button data-tool="erase" data-key="X">Erase</button>
      </nav>
      <input type="file" id="desk-file" accept=".json,application/json" hidden />`;
    document.body.appendChild(this.root);
    this.title = this.root.querySelector('#desk-title')!;
    this.drafts = this.root.querySelector('#desk-drafts')!;
    this.notes = this.root.querySelector('#desk-notes')!;
    this.inspector = this.root.querySelector('#desk-inspector')!;
    this.status = this.root.querySelector('#desk-status')!;
    this.fileInput = this.root.querySelector('#desk-file')!;
    this.details = this.root.querySelector('#desk-details')!;
    this.wireUi();
    this.wireDetails();
    this.wirePointer();
    this.wireKeys();
  }

  // ── Opening and closing ──────────────────────────────────────────────────

  /** Camera and focus when the reader left for the page, to return to. */
  private resumeView: { yaw: number; pitch: number; distance: number; x: number; z: number } | null = null;

  /**
   * Open the desk on a draft: the given one, the last one, or a copy of
   * Little Kindling. `resume` returns from reading the page: same draft,
   * same view, same undo history.
   */
  open(level?: LevelDefinition, resume = false) {
    if (resume && this.resumeView) return this.reopen();
    this.level = level ?? loadDraft() ?? copyOfChapter('little-kindling');
    this.resumeView = null;
    this.show();
    this.host.rig.set(0, 58, 58);
    this.focus.set(0, 0, 6);
    this.selected = null;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.rebuild();
    saveDraft(this.level);
  }

  private reopen() {
    const view = this.resumeView!;
    this.resumeView = null;
    this.show();
    this.host.rig.set(view.yaw, view.pitch, view.distance);
    this.focus.set(view.x, 0, view.z);
    this.rebuild();
  }

  private show() {
    this.isOpen = true;
    this.root.classList.remove('hidden');
    document.body.classList.add('at-desk');
    this.overlay.enabled = true;
    const { rig, controls } = this.host;
    controls.pointerLockEnabled = false;
    controls.wheelOverride = event => this.wheel(event);
    rig.limits = { minDistance: 10, maxDistance: 100, minPitch: 15, maxPitch: 88 };
  }

  close() {
    this.isOpen = false;
    this.drag = null;
    this.root.classList.add('hidden');
    document.body.classList.remove('at-desk');
    this.overlay.enabled = false;
    this.clearQuill();
    const { rig, controls } = this.host;
    controls.pointerLockEnabled = true;
    controls.wheelOverride = null;
    rig.limits = {
      minDistance: TUNING.camera.minDistance,
      maxDistance: TUNING.camera.maxDistance,
      minPitch: TUNING.camera.minPitch,
      maxPitch: TUNING.camera.maxPitch
    };
  }

  // ── Per frame ────────────────────────────────────────────────────────────

  update(frameDt: number) {
    if (!this.isOpen) return;
    // Pan the page with WASD, relative to the view, faster when zoomed out.
    const keys = this.host.controls.keys;
    const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    if ((forward !== 0 || right !== 0) && !this.typing()) {
      const yaw = this.host.rig.yaw * pc.math.DEG_TO_RAD;
      const speed = PAN_SPEED * (this.host.rig.distance / 50) * frameDt;
      this.focus.x = clampToPage(this.focus.x + (-Math.sin(yaw) * forward + Math.cos(yaw) * right) * speed);
      this.focus.z = clampToPage(this.focus.z + (-Math.cos(yaw) * forward - Math.sin(yaw) * right) * speed);
    }
    this.placeMarkers();
  }

  /** Debug and test view of the draft. */
  state() {
    return {
      open: this.isOpen,
      id: this.level.id,
      title: this.level.title,
      tool: this.tool,
      placeKind: this.placeKind,
      props: this.level.props.length,
      paths: this.level.paths.length,
      pond: this.level.pond,
      spawns: this.level.spawns.length,
      selected: this.selected === null ? null : { ...this.level.props[this.selected] },
      problems: this.problems.slice(),
      undo: this.undoStack.length,
      redo: this.redoStack.length,
      saved: this.saved
    };
  }

  /** The draft as its file text, for export and tests. */
  exportText() {
    return chapterJson(this.level);
  }

  // ── Edits ────────────────────────────────────────────────────────────────

  /**
   * Record, apply, validate, save and redraw one edit. Every change to the
   * draft goes through here, which is what makes undo and autosave exact.
   */
  private commit(change: (level: LevelDefinition) => void, rebuild = true) {
    this.undoStack.push(JSON.stringify(toLevelFile(this.level)));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    const next: LevelDefinition = structuredClone(this.level);
    change(next);
    this.level = next;
    this.afterChange(rebuild);
  }

  private afterChange(rebuild: boolean) {
    this.problems = [];
    try {
      validateLevel(toLevelFile(this.level));
    } catch (error) {
      this.problems = error instanceof LevelError ? error.problems : [String(error)];
    }
    this.saved = saveDraft(this.level);
    if (this.selected !== null && this.selected >= this.level.props.length) this.selected = null;
    if (rebuild) this.rebuild();
    else this.renderUi();
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(JSON.stringify(toLevelFile(this.level)));
    this.level = validateLevel(JSON.parse(previous));
    this.selected = null;
    this.afterChange(true);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(toLevelFile(this.level)));
    this.level = validateLevel(JSON.parse(next));
    this.selected = null;
    this.afterChange(true);
  }

  private rebuild() {
    this.host.build(this.level);
    this.renderUi();
  }

  setTool(tool: DeskTool, kind?: PropKind) {
    this.tool = tool;
    if (kind !== undefined) this.placeKind = kind;
    if (tool !== 'select') this.selected = null;
    this.renderUi();
  }

  private placeProp(x: number, z: number) {
    const kind = this.placeKind;
    const count = this.level.props.filter(p => p.kind === kind).length;
    const random = Math.random();
    const prop: PropPlacement = {
      kind,
      x: round(clampToPage(x)),
      z: round(clampToPage(z)),
      yaw: kind === PropKind.Cottage || kind === PropKind.Stall ? round(facingCentre(x, z), .1)
        : kind === PropKind.Tree || kind === PropKind.Haystack ? round(random * 360, .1) : 0,
      size: kind === PropKind.Tree ? round(.85 + random * .45) : 1,
      variant: kind === PropKind.Tree ? Math.floor(random * 1000) : count
    };
    this.commit(level => level.props.push(prop));
  }

  private adjustSelected(change: (p: PropPlacement) => void) {
    if (this.selected === null) return;
    const index = this.selected;
    this.commit(level => change(level.props[index]));
  }

  rotateSelected(degrees: number) {
    this.adjustSelected(p => { p.yaw = round(((p.yaw + degrees + 540) % 360) - 180, .1); });
  }

  resizeSelected(delta: number) {
    this.adjustSelected(p => { p.size = round(Math.max(.3, Math.min(3, p.size + delta))); });
  }

  nextDesign() {
    this.adjustSelected(p => { p.variant = p.kind === PropKind.Tree ? (p.variant + 137) % 1000 : p.variant + 1; });
  }

  removeSelected() {
    if (this.selected === null) return;
    const index = this.selected;
    this.selected = null;
    this.commit(level => level.props.splice(index, 1));
  }

  // ── Picking ──────────────────────────────────────────────────────────────

  /** Where a screen point lands on the page (the ground plane), or null. */
  groundAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const camera = this.host.camera.camera!;
    camera.screenToWorld(x, y, camera.nearClip, this.ray.from);
    camera.screenToWorld(x, y, camera.farClip, this.ray.to);
    const dy = this.ray.to.y - this.ray.from.y;
    if (Math.abs(dy) < 1e-6) return null;
    const t = -this.ray.from.y / dy;
    if (t < 0) return null;
    return {
      x: this.ray.from.x + (this.ray.to.x - this.ray.from.x) * t,
      z: this.ray.from.z + (this.ray.to.z - this.ray.from.z) * t
    };
  }

  private propAt(x: number, z: number): number | null {
    let best: number | null = null;
    let bestDistance = Infinity;
    this.level.props.forEach((p, i) => {
      const distance = Math.hypot(p.x - x, p.z - z);
      if (distance < pickRadius(p) && distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
  }

  private spawnAt(x: number, z: number): number | null {
    const index = this.level.spawns.findIndex(s => Math.hypot(s.x - x, s.z - z) < 1.8);
    return index >= 0 ? index : null;
  }

  private pathAt(x: number, z: number): number | null {
    let best: number | null = null;
    let bestDistance = 2.5;
    this.level.paths.forEach((path, i) => {
      for (let k = 0; k < path.length - 1; k++) {
        const [ax, az] = path[k];
        const [bx, bz] = path[k + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
        if (d < bestDistance) {
          best = i;
          bestDistance = d;
        }
      }
    });
    return best;
  }

  // ── Input ────────────────────────────────────────────────────────────────

  private wirePointer() {
    this.canvas.addEventListener('pointerdown', event => {
      if (!this.isOpen || event.button !== 0 || event.pointerType === 'touch') return;
      const at = this.groundAt(event.clientX, event.clientY);
      if (!at) return;
      this.canvas.setPointerCapture?.(event.pointerId);
      switch (this.tool) {
        case 'select': {
          const spawn = this.spawnAt(at.x, at.z);
          if (spawn !== null) {
            this.drag = { kind: 'spawn', index: spawn, moved: false, screenX: event.clientX, screenY: event.clientY };
            break;
          }
          const index = this.propAt(at.x, at.z);
          this.selected = index;
          if (index !== null) {
            const p = this.level.props[index];
            this.drag = { kind: 'prop', index, startX: p.x, startZ: p.z, offsetX: p.x - at.x, offsetZ: p.z - at.z, moved: false, screenX: event.clientX, screenY: event.clientY };
          }
          this.renderUi();
          break;
        }
        case 'place':
          this.placeProp(at.x, at.z);
          break;
        case 'path':
          this.drag = { kind: 'path', points: [[round(clampToPage(at.x)), round(clampToPage(at.z))]] };
          this.drawQuill();
          break;
        case 'pond':
          this.drag = { kind: 'pond', x: round(clampToPage(at.x)), z: round(clampToPage(at.z)), radius: this.level.pond?.[2] ?? 5 };
          this.drawQuill();
          break;
        case 'bookmark':
          this.setBookmark(at.x, at.z, event.shiftKey);
          break;
        case 'erase':
          this.eraseAt(at.x, at.z);
          break;
      }
    });

    this.canvas.addEventListener('pointermove', event => {
      if (!this.isOpen) return;
      const at = this.groundAt(event.clientX, event.clientY);
      this.hover = at;
      const drag = this.drag;
      if (!drag || !at) return;
      if (drag.kind === 'prop') {
        if (!drag.moved && Math.hypot(event.clientX - drag.screenX, event.clientY - drag.screenY) < 4) return;
        drag.moved = true;
        // Move the drawn cutout now; the draft changes when the drag ends.
        this.host.propRoot(drag.index)?.setPosition(clampToPage(at.x + drag.offsetX), 0, clampToPage(at.z + drag.offsetZ));
      } else if (drag.kind === 'spawn') {
        if (!drag.moved && Math.hypot(event.clientX - drag.screenX, event.clientY - drag.screenY) < 4) return;
        drag.moved = true;
        this.bookmarks[drag.index]?.setPosition(clampToPage(at.x), 0, clampToPage(at.z));
      } else if (drag.kind === 'path') {
        const [lx, lz] = drag.points[drag.points.length - 1];
        if (Math.hypot(at.x - lx, at.z - lz) >= 2 && drag.points.length < LEVEL_LIMITS.pathPoints) {
          drag.points.push([round(clampToPage(at.x)), round(clampToPage(at.z))]);
          this.drawQuill();
        }
      } else if (drag.kind === 'pond') {
        drag.radius = Math.max(1.5, Math.min(20, Math.hypot(at.x - drag.x, at.z - drag.z)));
        this.drawQuill();
      }
    });

    const finish = (event: PointerEvent) => {
      if (!this.isOpen || !this.drag) return;
      const drag = this.drag;
      this.drag = null;
      const at = this.groundAt(event.clientX, event.clientY);
      if (drag.kind === 'prop' && drag.moved && at) {
        const x = round(clampToPage(at.x + drag.offsetX));
        const z = round(clampToPage(at.z + drag.offsetZ));
        this.commit(level => {
          level.props[drag.index].x = x;
          level.props[drag.index].z = z;
        });
      } else if (drag.kind === 'spawn' && drag.moved && at) {
        const x = round(clampToPage(at.x));
        const z = round(clampToPage(at.z));
        this.commit(level => {
          level.spawns[drag.index] = { x, z, yaw: round(facingCentre(x, z), .1) };
        });
      } else if (drag.kind === 'path') {
        this.clearQuill();
        if (drag.points.length >= 2 && this.level.paths.length < LEVEL_LIMITS.paths) {
          this.commit(level => level.paths.push(drag.points));
        }
      } else if (drag.kind === 'pond') {
        this.clearQuill();
        this.commit(level => { level.pond = [drag.x, drag.z, round(drag.radius, .1)]; });
      }
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', finish);
  }

  private wheel(event: WheelEvent): boolean {
    if (!this.isOpen) return false;
    if (this.selected === null || (!event.shiftKey && !event.altKey)) return false;
    // Shift+wheel turns the selected cutout; Alt+wheel resizes it.
    if (event.shiftKey) this.rotateSelected(Math.sign(event.deltaY || event.deltaX) * 15);
    else this.resizeSelected(-Math.sign(event.deltaY) * .1);
    return true;
  }

  private wireKeys() {
    window.addEventListener('keydown', event => {
      if (!this.isOpen || this.typing()) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.code === 'KeyZ') {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (meta) return;
      const key = event.key.toUpperCase();
      const toolButton = this.root.querySelector<HTMLButtonElement>(`[data-key="${key}"]`);
      if (toolButton) {
        toolButton.click();
        return;
      }
      switch (event.code) {
        case 'KeyQ': this.rotateSelected(event.shiftKey ? -5 : -15); break;
        case 'KeyE': this.rotateSelected(event.shiftKey ? 5 : 15); break;
        case 'Minus': this.resizeSelected(-.1); break;
        case 'Equal': this.resizeSelected(.1); break;
        case 'KeyV': this.nextDesign(); break;
        case 'Delete':
        case 'Backspace': this.removeSelected(); break;
        case 'Escape':
          this.selected = null;
          this.renderUi();
          break;
        default: break;
      }
    });
  }

  private typing() {
    const active = document.activeElement;
    return active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement;
  }

  private setBookmark(x: number, z: number, add: boolean) {
    const spawn = { x: round(clampToPage(x)), z: round(clampToPage(z)), yaw: round(facingCentre(x, z), .1) };
    this.commit(level => {
      if (add && level.spawns.length < LEVEL_LIMITS.spawns) level.spawns.push(spawn);
      else level.spawns[0] = spawn;
    });
  }

  private eraseAt(x: number, z: number) {
    const spawn = this.spawnAt(x, z);
    if (spawn !== null && this.level.spawns.length > 1) return this.commit(level => { level.spawns.splice(spawn, 1); });
    const prop = this.propAt(x, z);
    if (prop !== null) return this.commit(level => { level.props.splice(prop, 1); });
    const pond = this.level.pond;
    if (pond && Math.hypot(pond[0] - x, pond[1] - z) < pond[2]) return this.commit(level => { level.pond = null; });
    const path = this.pathAt(x, z);
    if (path !== null) this.commit(level => { level.paths.splice(path, 1); });
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  private wireUi() {
    this.root.querySelector('#desk-tray')!.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-tool]');
      if (!button) return;
      const kind = button.dataset.kind !== undefined ? Number(button.dataset.kind) as PropKind : undefined;
      this.setTool(button.dataset.tool as DeskTool, kind);
      button.blur();
    });
    this.root.querySelector('.desk-actions')!.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
      if (!button) return;
      button.blur();
      switch (button.dataset.action) {
        case 'new': this.switchTo(blankChapter()); break;
        case 'copy': this.switchTo(copyOfChapter('little-kindling')); break;
        case 'export': this.download(); break;
        case 'import': this.fileInput.click(); break;
        case 'undo': this.undo(); break;
        case 'redo': this.redo(); break;
        case 'read': this.readPage(); break;
        case 'details':
          this.root.querySelector('#desk-details')!.classList.toggle('hidden');
          this.renderDetails();
          break;
        case 'close': this.host.close(); break;
      }
    });
    this.title.addEventListener('change', () => {
      const title = this.title.value.trim().slice(0, 80) || 'An Untitled Chapter';
      this.commit(level => { level.title = title; }, false);
      this.title.blur();
    });
    this.title.addEventListener('keydown', event => {
      if (event.key === 'Enter') this.title.blur();
    });
    this.drafts.addEventListener('change', () => {
      const level = loadDraft(this.drafts.value);
      if (level) this.switchTo(level);
      this.drafts.blur();
    });
    this.fileInput.addEventListener('change', async () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (!file) return;
      try {
        this.switchTo(parseChapter(await file.text()));
      } catch (error) {
        const problems = error instanceof LevelError ? error.problems : [error instanceof Error ? error.message : String(error)];
        this.flashNotes(['That file is not a chapter this desk can read.', ...problems.slice(0, 6)]);
      }
    });
  }

  /** Open a different draft in place, keeping the camera where it is. */
  private switchTo(level: LevelDefinition) {
    this.level = level;
    this.selected = null;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.afterChange(true);
  }

  readPage() {
    if (this.problems.length > 0) {
      this.flashNotes(['The page cannot be read until the margin notes are settled.']);
      return;
    }
    const rig = this.host.rig;
    this.resumeView = { yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance, x: this.focus.x, z: this.focus.z };
    this.host.read(this.level);
  }

  private download() {
    const blob = new Blob([this.exportText()], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${this.level.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chapter'}.chapter.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  private flashNotes(lines: string[]) {
    this.notes.innerHTML = lines.map(line => `<p class="desk-note urgent">${escapeHtml(line)}</p>`).join('');
    this.notes.classList.remove('flash');
    void this.notes.offsetWidth;
    this.notes.classList.add('flash');
  }

  private renderUi() {
    if (document.activeElement !== this.title) this.title.value = this.level.title;
    this.drafts.innerHTML = listDrafts()
      .map(d => `<option value="${d.id}"${d.id === this.level.id ? ' selected' : ''}>${escapeHtml(d.title)}</option>`)
      .join('') || `<option>${escapeHtml(this.level.title)}</option>`;

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#desk-tray button')) {
      const active = button.dataset.tool === this.tool && (this.tool !== 'place' || Number(button.dataset.kind) === this.placeKind);
      button.classList.toggle('active', active);
    }
    this.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = this.undoStack.length === 0;
    this.root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled = this.redoStack.length === 0;

    const counts = new Map<PropKind, number>();
    for (const p of this.level.props) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    const cottages = counts.get(PropKind.Cottage) ?? 0;
    const tips: string[] = [];
    if (this.problems.length > 0) tips.push(...this.problems.slice(0, 6).map(marginNote));
    else {
      if (this.level.props.length === 0) tips.push('An empty page. Pick a cutout from the tray and click to place it.');
      else if (cottages === 0) tips.push('No cottages yet: dwarves live in cottages, so nobody will come out to play.');
      if (!this.saved) tips.push('This browser would not keep the draft. Export it to be safe.');
    }
    tips.push(TOOL_TIPS[this.tool]);
    this.notes.innerHTML = tips.map((t, i) => `<p class="desk-note${i < this.problems.length ? ' urgent' : ''}">${escapeHtml(t)}</p>`).join('');

    this.status.textContent = `${this.level.props.length} cutouts · ${cottages} cottages · ${this.level.paths.length} paths · ${this.level.pond ? 'a pond' : 'no pond'} · ${this.level.spawns.length} bookmark${this.level.spawns.length === 1 ? '' : 's'}`;

    this.renderDetails();

    if (this.selected !== null) {
      const p = this.level.props[this.selected];
      const name = KIND_ORDER.find(([k]) => k === p.kind)?.[1] ?? 'Cutout';
      this.inspector.classList.remove('hidden');
      this.inspector.innerHTML = `<div class="desk-inspector-title">${name}</div>
        <div>facing ${Math.round(p.yaw)}° · size ${p.size.toFixed(2)} · design ${p.variant}</div>
        <div class="desk-keys"><kbd>Q</kbd><kbd>E</kbd> turn · <kbd>−</kbd><kbd>+</kbd> size · <kbd>V</kbd> design · <kbd>Del</kbd> remove</div>`;
    } else {
      this.inspector.classList.add('hidden');
    }
  }

  // ── Chapter details ──────────────────────────────────────────────────────

  setMood(mood: Mood) {
    if ((this.level.mood ?? 'afternoon') === mood) return;
    this.commit(level => { level.mood = mood; });
  }

  private wireDetails() {
    const heading = this.details.querySelector<HTMLInputElement>('#details-heading')!;
    const opening = this.details.querySelector<HTMLTextAreaElement>('#details-opening')!;
    const ending = this.details.querySelector<HTMLTextAreaElement>('#details-ending')!;
    heading.addEventListener('change', () => {
      const value = heading.value.trim();
      this.commit(level => { level.heading = value || undefined; }, false);
    });
    const narration = (key: 'opening' | 'ending', field: HTMLTextAreaElement) => field.addEventListener('change', () => {
      const value = field.value.trim();
      this.commit(level => {
        level.narration = { ...level.narration, [key]: value || undefined };
        if (!level.narration.opening && !level.narration.ending) level.narration = undefined;
      }, false);
    });
    narration('opening', opening);
    narration('ending', ending);

    this.details.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      const moodButton = target.closest<HTMLButtonElement>('[data-mood]');
      if (moodButton) {
        moodButton.blur();
        this.setMood(moodButton.dataset.mood as Mood);
        return;
      }
      const action = target.closest<HTMLButtonElement>('[data-deed-action]')?.dataset.deedAction;
      if (action === 'add') {
        this.commit(level => {
          const deeds = level.deeds ?? structuredClone(DEFAULT_DEEDS);
          if (deeds.length < CHAPTER_LIMITS.deeds) deeds.push({ template: 'ignite-dwarves', count: 3 });
          level.deeds = deeds;
        }, false);
      } else if (action === 'usual') {
        this.commit(level => { level.deeds = undefined; }, false);
      }
      const remove = target.closest<HTMLButtonElement>('[data-deed-remove]');
      if (remove) {
        const index = Number(remove.dataset.deedRemove);
        this.commit(level => {
          const deeds = level.deeds ?? structuredClone(DEFAULT_DEEDS);
          deeds.splice(index, 1);
          level.deeds = deeds;
        }, false);
      }
    });
    // Deed rows edit in place; commit when a field settles.
    this.details.addEventListener('change', event => {
      const row = (event.target as HTMLElement).closest<HTMLLIElement>('[data-deed]');
      if (!row) return;
      const index = Number(row.dataset.deed);
      const template = row.querySelector<HTMLSelectElement>('select')!.value as DeedTemplate;
      const count = Math.max(1, Math.min(CHAPTER_LIMITS.deedCount, Math.round(Number(row.querySelector<HTMLInputElement>('.deed-count')!.value) || 1)));
      const title = row.querySelector<HTMLInputElement>('.deed-title-input')!.value.trim().slice(0, CHAPTER_LIMITS.deedTitle);
      this.commit(level => {
        const deeds = level.deeds ?? structuredClone(DEFAULT_DEEDS);
        deeds[index] = { template, count, ...(title ? { title } : {}) };
        level.deeds = deeds;
      }, false);
    });
  }

  private renderDetails() {
    if (this.details.classList.contains('hidden')) return;
    const active = document.activeElement;
    const heading = this.details.querySelector<HTMLInputElement>('#details-heading')!;
    const opening = this.details.querySelector<HTMLTextAreaElement>('#details-opening')!;
    const ending = this.details.querySelector<HTMLTextAreaElement>('#details-ending')!;
    if (active !== heading) heading.value = this.level.heading ?? '';
    if (active !== opening) opening.value = this.level.narration?.opening ?? '';
    if (active !== ending) ending.value = this.level.narration?.ending ?? '';
    const mood = this.level.mood ?? 'afternoon';
    for (const button of this.details.querySelectorAll<HTMLButtonElement>('[data-mood]')) {
      button.classList.toggle('active', button.dataset.mood === mood);
    }
    const custom = this.level.deeds !== undefined;
    const deeds = this.level.deeds ?? DEFAULT_DEEDS;
    const list = this.details.querySelector<HTMLOListElement>('#details-deeds')!;
    if (list.contains(active)) return;
    list.innerHTML = deeds.map((deed, i) => deedRow(deed, i)).join('') +
      (custom ? '' : '<li class="details-usual">These are the usual deeds. Change any to make them this chapter\'s own.</li>');
  }

  // ── Markers ──────────────────────────────────────────────────────────────

  private flatMarker(material: pc.Material) {
    const entity = meshEntity('Desk marker', centredQuadMesh(), material, this.overlay, { castShadows: false, receiveShadows: false });
    entity.setLocalEulerAngles(-90, 0, 0);
    entity.enabled = false;
    return entity;
  }

  private placeMarkers() {
    const selected = this.selected !== null ? this.level.props[this.selected] : null;
    const drag = this.drag;
    if (selected) {
      const root = drag?.kind === 'prop' && drag.moved ? this.host.propRoot(drag.index)?.getPosition() : null;
      const size = pickRadius(selected) * 2.2;
      this.selectRing.enabled = true;
      this.selectRing.setPosition(root?.x ?? selected.x, .06, root?.z ?? selected.z);
      this.selectRing.setLocalScale(size, size, 1);
    } else {
      this.selectRing.enabled = false;
    }
    // The hover ring previews what a click would pick or where a cutout would land.
    const hover = this.hover;
    if (hover && !drag && (this.tool === 'place' || this.tool === 'erase' || this.tool === 'select')) {
      const under = this.tool === 'place' ? null : this.propAt(hover.x, hover.z);
      const target = under !== null ? this.level.props[under] : null;
      const size = target ? pickRadius(target) * 2.2 : this.tool === 'place' ? pickRadius({ kind: this.placeKind, x: 0, z: 0, yaw: 0, size: 1, variant: 0 }) * 2.2 : 0;
      this.hoverRing.enabled = size > 0;
      this.hoverRing.setPosition(target?.x ?? hover.x, .05, target?.z ?? hover.z);
      this.hoverRing.setLocalScale(size, size, 1);
    } else {
      this.hoverRing.enabled = false;
    }

    // Bookmarks: one ribbon per spawn, standing on the page.
    while (this.bookmarks.length < this.level.spawns.length) {
      const i = this.bookmarks.length;
      const ribbon = meshEntity('Bookmark', quadMesh(), this.bookmarkMaterials[i % 4], this.overlay, { castShadows: true });
      ribbon.setLocalScale(1.4, 2.8, 1);
      this.bookmarks.push(ribbon);
    }
    while (this.bookmarks.length > this.level.spawns.length) this.bookmarks.pop()!.destroy();
    const cameraYaw = this.host.rig.yaw;
    this.level.spawns.forEach((spawn, i) => {
      const ribbon = this.bookmarks[i];
      const dragging = drag?.kind === 'spawn' && drag.index === i && drag.moved;
      if (!dragging) ribbon.setPosition(spawn.x, 0, spawn.z);
      ribbon.setEulerAngles(0, cameraYaw, 0);
    });
  }

  private drawQuill() {
    this.clearQuill();
    const drag = this.drag;
    if (drag?.kind === 'path') {
      for (const [x, z] of drag.points) this.quillDots.push(this.dot(x, z, 1.4));
    } else if (drag?.kind === 'pond') {
      const steps = 28;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        this.quillDots.push(this.dot(drag.x + Math.cos(a) * drag.radius, drag.z + Math.sin(a) * drag.radius, .9));
      }
    }
  }

  private dot(x: number, z: number, size: number) {
    const dot = meshEntity('Quill dot', centredQuadMesh(), this.dotMaterial, this.overlay, { castShadows: false, receiveShadows: false });
    dot.setLocalEulerAngles(-90, 0, 0);
    dot.setPosition(x, .08, z);
    dot.setLocalScale(size, size, 1);
    return dot;
  }

  private clearQuill() {
    for (const dot of this.quillDots) dot.destroy();
    this.quillDots = [];
  }
}

const MOOD_NAMES: Record<Mood, string> = {
  afternoon: 'Golden afternoon',
  moonlit: 'Moonlit night',
  snow: 'First snow'
};

const TEMPLATE_NAMES: Record<DeedTemplate, string> = {
  'ignite-dwarves': 'Set dwarves alight',
  'launch-dwarves': 'Launch dwarves',
  'relaunch-dwarf': 'Launch one dwarf twice',
  'burn-cottages': 'Burn cottages',
  'flatten-cottages': 'Flatten cottages',
  'undo-cottages': 'Undo cottages, either way',
  'burn-haystacks': 'Burn haystacks',
  'burn-stalls': 'Burn market stalls',
  'burn-trees': 'Burn trees',
  'burn-maypole': 'Burn the maypole',
  'chain': 'Reach a chain of',
  'ghosts': 'Make ghosts'
};

const deedRow = (deed: DeedSpec, index: number) => {
  const wording = deedWording(deed);
  return `<li data-deed="${index}">
    <select aria-label="Goal">${DEED_TEMPLATES.map(t => `<option value="${t}"${t === deed.template ? ' selected' : ''}>${TEMPLATE_NAMES[t]}</option>`).join('')}</select>
    <input class="deed-count" type="number" min="1" max="${CHAPTER_LIMITS.deedCount}" value="${deed.count}" aria-label="How many" />
    <input class="deed-title-input" maxlength="${CHAPTER_LIMITS.deedTitle}" value="${escapeHtml(deed.title ?? '')}" placeholder="${escapeHtml(wording.title)}" aria-label="Title" />
    <button data-deed-remove="${index}" aria-label="Remove">×</button>
  </li>`;
};

const TOOL_TIPS: Record<DeskTool, string> = {
  select: 'Click a cutout to pick it up; drag to move it. Drag a bookmark to move where a drake enters.',
  place: 'Click the page to place the cutout. Shift+wheel turns it once placed; Alt+wheel resizes.',
  path: 'Hold and draw to lay a parchment path.',
  pond: 'Click to place the pond; drag to size it. A chapter has one pond.',
  bookmark: 'Click to set where the drake enters. Shift+click adds a bookmark for another seat, up to four.',
  erase: 'Click a cutout, path, pond or extra bookmark to remove it.'
};

/** The validator's findings, in the narrator's voice. */
const marginNote = (problem: string) => {
  if (problem.includes('position off the page')) return `${problem.split(':')[0]} has wandered off the page.`;
  if (problem.startsWith('at most')) return `Too many ${problem.split(' ').pop()}: the binding will not hold ${problem}.`;
  if (problem.startsWith('title')) return 'The chapter needs a title, and a short one.';
  return problem;
};

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
