/**
 * `window.__FIRE_DRAKE_DEBUG__`: the automation surface.
 *
 * **Must survive every refactor.** The Playwright suite, the MCP workflow and
 * the gameplay recorder all drive the game through it. Its shape is the
 * contract; this module only reads the game through {@link DebugContext}.
 */

import * as pc from 'playcanvas';
import { PropKind, PropState } from '../sim/props';
import type { Rampage } from '../sim/rampage';
import type { DrakeSim } from '../sim/drake';
import type { World } from '../sim/world';
import { TUNING } from '../tuning';
import type { DrakeView } from '../view/drake';
import type { Fx } from '../view/fx';
import type { Stage } from '../view/stage';
import type { Party } from '../party';
import type { CameraRig } from './camera';
import type { Controls } from './input';
import type { ExtractedSector } from './extracted';

export type SceneName = 'cave' | 'forest' | 'forestExtract';
type TargetKind = 'dwarf' | 'cottage' | 'haystack' | 'stall' | 'maypole' | 'tree' | 'fence';

declare global {
  interface Window {
    __FIRE_DRAKE_DEBUG__: {
      getState: () => object;
      teleport: (x: number, z: number) => void;
      loadScene: (name: SceneName) => void;
      resetCamera: () => void;
      lookAt: (x: number, z: number) => void;
      poseBone: (name: string, x: number, y: number, z: number) => void;
      boneLocal: (name: string) => number[] | null;
      setCamera: (yaw: number, pitch: number, distance: number) => void;
      dropConnection: () => void;
      nearest: (kind: TargetKind) => { x: number; z: number; distance: number } | null;
    };
  }
}

export type DebugContext = {
  scene: () => SceneName;
  loadScene: (name: SceneName) => void;
  rampage: () => Rampage;
  stage: () => Stage;
  party: () => Party | null;
  extracted: () => ExtractedSector;
  simWorld: World;
  drakeSim: DrakeSim;
  drake: DrakeView;
  camera: pc.Entity;
  rig: CameraRig;
  controls: Controls;
  fx: Fx;
};

const TARGET_KINDS: Record<Exclude<TargetKind, 'dwarf'>, PropKind> = {
  cottage: PropKind.Cottage,
  haystack: PropKind.Haystack,
  stall: PropKind.Stall,
  maypole: PropKind.Maypole,
  tree: PropKind.Tree,
  fence: PropKind.Fence
};

const CONTACT_BONES = ['foot_L_0146', 'foot_R_0150', 'shin_L_0145', 'f_middle_03_L_094', 'f_middle_03_R_0124', 'hand_L_086', 'hand_R_0116', 'spine_004_04'];

export function installDebugApi(ctx: DebugContext) {
  const t = { x: 0, y: 0, z: 0, yaw: 0 };
  const drakeYaw = () => {
    ctx.simWorld.state.transform(ctx.drakeSim.id, t);
    return t.yaw;
  };

  window.__FIRE_DRAKE_DEBUG__ = {
    getState: () => {
      const rampage = ctx.rampage();
      const party = ctx.party();
      const touch = ctx.controls.touch;
      const drakePosition = ctx.drake.root.getPosition();
      const cameraAt = ctx.camera.getPosition();
      const yaw = drakeYaw();
      return {
        scene: ctx.scene(),
        modelReady: ctx.drake.modelReady,
        pointerLocked: ctx.controls.pointerLocked,
        pointerLockRequested: ctx.controls.pointerLockRequested,
        drake: { x: drakePosition.x, y: drakePosition.y, z: drakePosition.z, yaw },
        camera: {
          x: cameraAt.x,
          y: cameraAt.y,
          z: cameraAt.z,
          yaw: ctx.rig.yaw,
          pitch: ctx.rig.pitch,
          distance: ctx.rig.distance,
          targetDistance: ctx.rig.targetDistance
        },
        model: {
          scale: TUNING.drake.modelScale,
          rotation: { ...TUNING.drake.modelRotation },
          offset: { ...TUNING.drake.modelOffset },
          forwardAlignment: ctx.drake.getVisualForwardAlignment(yaw),
          bounds: ctx.drake.bounds(),
          contacts: ctx.drake.boneHeights(CONTACT_BONES)
        },
        effects: {
          breathParticles: ctx.fx.countOf('breath'),
          activeDwarves: rampage.livingDwarves,
          burningProps: ctx.stage().props.filter(p => p.burning).length,
          particles: ctx.fx.count
        },
        mayhem: { score: rampage.score, combo: rampage.combo, bestCombo: rampage.bestCombo },
        touch: touch ? { forward: touch.forward, right: touch.right, charging: touch.charging, breathing: touch.breathing } : null,
        net: party ? {
          status: party.session.status,
          seat: party.seat,
          room: party.room,
          latencyMs: Math.round(party.session.latencyMs),
          players: party.session.roster.length,
          remoteDrakes: party.session.roster.length - 1,
          lastCorrection: party.lastCorrection
        } : null,
        nearestDwarf: nearest('dwarf', true),
        extracted: { ...ctx.extracted() }
      };
    },
    teleport: (x, z) => {
      ctx.drakeSim.place(ctx.simWorld, x, z);
      ctx.drake.sync(ctx.simWorld.state);
    },
    loadScene: name => ctx.loadScene(name),
    poseBone: (name, x, y, z) => {
      if (x === 0 && y === 0 && z === 0) ctx.drake.poseOverrides.delete(name);
      else ctx.drake.poseOverrides.set(name, new pc.Vec3(x, y, z));
    },
    boneLocal: name => ctx.drake.boneLocal(name),
    setCamera: (yaw, pitch, distance) => ctx.rig.set(yaw, pitch, distance),
    lookAt: (x, z) => {
      const at = ctx.drake.root.getPosition();
      ctx.rig.yawTarget = Math.atan2(-(x - at.x), -(z - at.z)) * pc.math.RAD_TO_DEG;
    },
    dropConnection: () => ctx.party()?.session.simulateDrop(),
    nearest: kind => nearest(kind, false),
    resetCamera: () => ctx.rig.reset(drakeYaw())
  };

  /** Closest untouched target. `anyDwarf` includes burning and flying ones. */
  function nearest(kind: TargetKind, anyDwarf: boolean) {
    const at = ctx.drake.root.getPosition();
    const rampage = ctx.rampage();
    let best: { x: number; z: number; distance: number } | null = null;
    const consider = (x: number, z: number) => {
      const distance = Math.hypot(x - at.x, z - at.z);
      if (!best || distance < best.distance) best = { x, z, distance };
    };
    if (kind === 'dwarf') {
      for (const d of rampage.dwarves) {
        if (d.dead || (!anyDwarf && (d.burning || d.airborne))) continue;
        if (ctx.simWorld.state.transform(d.id, t)) consider(t.x, t.z);
      }
    } else {
      for (const p of rampage.props) if (p.kind === TARGET_KINDS[kind] && p.state === PropState.Intact) consider(p.x, p.z);
    }
    return best;
  }
}
