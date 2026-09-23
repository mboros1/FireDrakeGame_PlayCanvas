/**
 * View-side drake: model, materials, animation graph and presentation. The
 * gameplay state lives in `DrakeSim`; this class reads it and draws it.
 *
 * Per `docs/ARCHITECTURE.md`, the client owns the animation graph and the
 * simulation replicates only the state that drives it — here, speed.
 */

import * as pc from 'playcanvas';
import { TUNING } from '../tuning';
import type { DrakeSim } from '../sim/drake';
import type { Transform, WorldState } from '../sim/types';

export const loadAsset = (app: pc.AppBase, url: string, type: string) =>
  new Promise<pc.Asset>((resolve, reject) => {
    app.assets.loadFromUrl(url, type, (error, asset) => {
      if (error || !asset) reject(new Error(String(error ?? `Could not load ${url}`)));
      else resolve(asset);
    });
  });

type Clip = 'Idle' | 'Walk' | 'Run';

export class DrakeView {
  readonly root = new pc.Entity('Drake');
  modelReady = false;
  loadError: string | null = null;
  headNode: pc.GraphNode | null = null;
  private tailNode: pc.GraphNode | null = null;
  private mouthNodes: pc.GraphNode[] = [];
  private readonly visual = new pc.Entity('Fire Drake Visual');
  private readonly placeholder = new pc.Entity('Loading Drake');
  private anim: pc.AnimComponent | null = null;
  private rootBone: pc.GraphNode | null = null;
  private clip: Clip | null = null;
  private material: pc.StandardMaterial | null = null;
  private readonly mouthLight = new pc.Entity('Mouth glow');
  private breathGlow = 0;
  private lean = 0;
  private readonly scratch: Transform = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(private readonly app: pc.AppBase, private readonly sim: DrakeSim, parent: pc.Entity) {
    this.root.addChild(this.visual);
    this.visual.addChild(this.placeholder);
    const body = new pc.Entity('Body');
    body.addComponent('render', { type: 'capsule' });
    body.setLocalPosition(0, 1.1, 0);
    body.setLocalScale(1.2, 1.8, 1.2);
    body.setLocalEulerAngles(90, 0, 0);
    this.placeholder.addChild(body);

    this.mouthLight.addComponent('light', {
      type: 'omni',
      color: new pc.Color(1, .6, .25),
      intensity: 0,
      range: 7,
      castShadows: false
    });
    this.mouthLight.setLocalPosition(0, 1.6, -3);
    this.root.addChild(this.mouthLight);
    parent.addChild(this.root);
    void this.loadModel();
  }

  /** Copy the simulated transform onto the rendered entity. */
  sync(state: WorldState) {
    state.transform(this.sim.id, this.scratch);
    this.root.setPosition(this.scratch.x, this.scratch.y, this.scratch.z);
    this.root.setEulerAngles(0, this.scratch.yaw, 0);
  }

  update(state: WorldState, dt: number, elapsed: number) {
    this.sync(state);
    const speed = Math.abs(this.sim.speed);

    // Lean into turns and charges; bob a little with the gait.
    const targetLean = speed > TUNING.drake.walkSpeed + 1 ? 6 : 0;
    this.lean = pc.math.lerp(this.lean, targetLean, Math.min(1, dt * 5));
    this.visual.setLocalEulerAngles(-this.lean, 0, 0);
    if (!this.anim) {
      this.visual.setLocalPosition(0, Math.abs(Math.sin(elapsed * 7)) * Math.min(.12, speed * .012), 0);
    }

    if (this.anim) {
      const clip: Clip = speed < .6 ? 'Idle' : speed > TUNING.drake.walkSpeed + 1.5 ? 'Run' : 'Walk';
      if (clip !== this.clip) {
        this.clip = clip;
        this.anim.baseLayer!.transition(clip, .25);
      }
      // Scale the stride to the ground speed so feet do not skate.
      this.anim.speed = clip === 'Idle' ? 1 : pc.math.clamp(speed / (clip === 'Run' ? 11 : 6.5), .5, 2.2);
      // The exported clips drive the root bone ~48 km below the model: an
      // Unreal root-motion offset baked into the wrong space. Keep the sway,
      // drop the offset. The anim system has already run this frame.
      if (this.rootBone) {
        const p = this.rootBone.getLocalPosition();
        this.rootBone.setLocalPosition(p.x, 0, 0);
      }
    }

    this.breathGlow = pc.math.lerp(this.breathGlow, this.sim.breathed ? 1 : 0, Math.min(1, dt * (this.sim.breathed ? 30 : 6)));
    this.mouthLight.light!.intensity = this.breathGlow * 3.2 * (.85 + Math.random() * .3);
    if (this.material) {
      this.material.emissiveIntensity = 1.4 + this.breathGlow * 1.4;
      this.material.update();
    }
  }

  /** World-space mouth, from the live jaw bones once the model is in. */
  mouthPosition(out: pc.Vec3) {
    if (this.mouthNodes.length > 0) {
      out.set(0, 0, 0);
      for (const node of this.mouthNodes) out.add(node.getPosition());
      return out.mulScalar(1 / this.mouthNodes.length);
    }
    return out.copy(this.root.getPosition()).add(new pc.Vec3(this.sim.forwardX * 2.8, 1.5, this.sim.forwardZ * 2.8));
  }

  /** Rendered bounds, for the debug surface: catches a drake that animates off-screen. */
  bounds() {
    const renders = this.root.findComponents('render') as pc.RenderComponent[];
    const box = new pc.BoundingBox();
    let first = true;
    for (const render of renders) {
      if (!render.entity.enabled) continue;
      for (const mi of render.meshInstances) {
        if (first) { box.copy(mi.aabb); first = false; } else box.add(mi.aabb);
      }
    }
    return first ? null : { centre: box.center.toString(), halfExtents: box.halfExtents.toString(), head: this.headNode?.getPosition().toString() };
  }

  getVisualForwardAlignment(yaw: number) {
    if (!this.headNode || !this.tailNode) return null;
    const visualForward = this.headNode.getPosition().clone().sub(this.tailNode.getPosition());
    visualForward.y = 0;
    if (visualForward.lengthSq() < .001) return null;
    visualForward.normalize();
    const yawRadians = yaw * pc.math.DEG_TO_RAD;
    const gameplayForward = new pc.Vec3(-Math.sin(yawRadians), 0, -Math.cos(yawRadians));
    return visualForward.dot(gameplayForward);
  }

  private async loadModel() {
    try {
      const app = this.app;
      const [containerAsset, baseColorAsset, emissiveAsset, normalAsset] = await Promise.all([
        loadAsset(app, '/assets/wyvern/wyvern.glb', 'container'),
        loadAsset(app, '/assets/wyvern/wyvern_base.webp', 'texture'),
        loadAsset(app, '/assets/wyvern/wyvern_emissive.webp', 'texture'),
        loadAsset(app, '/assets/wyvern/wyvern_normal.webp', 'texture')
      ]);
      const container = containerAsset.resource as pc.ContainerResource;
      const model = container.instantiateRenderEntity({ castShadows: true });
      model.name = 'Actual Fire Drake';
      model.setLocalScale(TUNING.drake.modelScale, TUNING.drake.modelScale, TUNING.drake.modelScale);
      model.setLocalEulerAngles(TUNING.drake.modelRotation.x, TUNING.drake.modelRotation.y, TUNING.drake.modelRotation.z);
      model.setLocalPosition(TUNING.drake.modelOffset.x, TUNING.drake.modelOffset.y, TUNING.drake.modelOffset.z);

      const material = new pc.StandardMaterial();
      material.diffuseMap = baseColorAsset.resource as pc.Texture;
      material.normalMap = normalAsset.resource as pc.Texture;
      material.bumpiness = 1.2;
      material.emissiveMap = emissiveAsset.resource as pc.Texture;
      material.emissive = new pc.Color(1, .75, .5);
      material.emissiveIntensity = 1.4;
      material.metalness = .05;
      material.useMetalness = true;
      material.gloss = .45;
      material.sheen = new pc.Color(.5, .2, .1);
      material.cull = pc.CULLFACE_NONE;
      material.update();
      this.material = material;

      for (const render of model.findComponents('render') as pc.RenderComponent[]) {
        for (const meshInstance of render.meshInstances) meshInstance.material = material;
      }
      this.headNode = model.findByName('head_021');
      this.tailNode = model.findByName('tip_013');
      this.mouthNodes = ['mouth7_L_001_047', 'mouth7_R_001_066']
        .map(name => model.findByName(name))
        .filter((node): node is pc.GraphNode => node !== null);
      this.visual.addChild(model);
      this.placeholder.enabled = false;
      this.modelReady = true;

      // Animation clips arrive separately and must not hold up the model.
      void this.loadAnimations(model);
    } catch (error) {
      console.error('The real Fire Drake model could not be loaded', error);
      this.loadError = error instanceof Error ? error.message : String(error);
    }
  }

  private async loadAnimations(model: pc.Entity) {
    try {
      const [idle, walk] = await Promise.all([
        loadAsset(this.app, '/assets/wyvern/idle.glb', 'container'),
        loadAsset(this.app, '/assets/wyvern/walk.glb', 'container')
      ]);
      const track = (asset: pc.Asset) => (asset.resource as unknown as { animations: pc.Asset[] }).animations[0].resource as pc.AnimTrack;
      model.addComponent('anim', { activate: true });
      const anim = model.anim!;
      anim.assignAnimation('Idle', track(idle));
      anim.assignAnimation('Walk', track(walk));
      anim.assignAnimation('Run', track(walk));
      anim.baseLayer!.play('Idle');
      this.rootBone = model.findByName('spine_004_04');
      this.clip = 'Idle';
      this.anim = anim;
    } catch (error) {
      // A drake in bind pose is still a drake. Say so and carry on.
      console.warn('Fire Drake animations could not be loaded; rendering in bind pose.', error);
    }
  }
}
