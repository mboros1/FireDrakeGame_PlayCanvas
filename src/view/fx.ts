/**
 * Pooled billboard particles and flickering fire lights.
 *
 * Every particle is a camera-facing quad sharing one material per kind, so a
 * burning village costs a few hundred draw calls at worst rather than a few
 * thousand materials. Fading is done with scale, not alpha, for the same
 * reason. View-only: nothing here feeds back into the simulation.
 */

import * as pc from 'playcanvas';
import {
  drawAshFlake,
  drawConfetti,
  drawFlame,
  drawGhost,
  drawPaperFlame,
  drawSmoke,
  drawSnowflake,
  drawSoftDot,
  PALETTE
} from './art';
import { canvasTexture, centredQuadMesh, cutoutMaterial, glowMaterial, paintMaterial, smokeMaterial } from './paper';

export type ParticleKind = 'breath' | 'flame' | 'paperFlame' | 'ember' | 'smoke' | 'ash' | 'confetti' | 'ghost' | 'spark' | 'dust' | 'snow';

type Particle = {
  entity: pc.Entity;
  kind: ParticleKind;
  velocity: pc.Vec3;
  life: number;
  maxLife: number;
  size: number;
  spin: number;
  angle: number;
  drag: number;
  gravity: number;
  grow: number;
  stretch: number;
};

type KindSpec = { material: pc.Material; shadows?: boolean };

export class Fx {
  private readonly live: Particle[] = [];
  private readonly pools = new Map<ParticleKind, pc.Entity[]>();
  private readonly specs: Record<ParticleKind, KindSpec>;
  private readonly lights: { entity: pc.Entity; target: pc.Vec3 | null; strength: number; seed: number }[] = [];
  private readonly scratch = new pc.Vec3();
  private readonly cameraRotation = new pc.Quat();
  private readonly spinQuat = new pc.Quat();

  constructor(private readonly root: pc.Entity, lightCount = 6) {
    const breath = glowMaterial(canvasTexture(drawFlame('rgba(255,236,160,1)', 'rgba(255,110,20,.8)'), { softAlpha: true }), new pc.Color(1, .42, .1), .7);
    const flame = glowMaterial(canvasTexture(drawFlame('rgba(255,230,150,1)', 'rgba(255,90,20,.8)'), { softAlpha: true }), new pc.Color(1, .4, .1), .6);
    const ember = glowMaterial(canvasTexture(drawSoftDot('rgba(255,210,120,1)'), { softAlpha: true }), new pc.Color(1, .55, .2), 4);
    const spark = glowMaterial(canvasTexture(drawSoftDot('rgba(255,255,230,1)'), { softAlpha: true }), new pc.Color(1, .9, .6), 5);
    const smoke = smokeMaterial(canvasTexture(drawSmoke(3), { softAlpha: true }));
    const dust = smokeMaterial(canvasTexture(drawSoftDot('rgba(230,210,170,.8)'), { softAlpha: true }));
    // Unlit, so the flame's paper colours arrive exactly as drawn: sun and
    // fire-light on a lit flame wash it out to pink.
    const paperFlame = paintMaterial(canvasTexture(drawPaperFlame()), true);
    paperFlame.emissiveIntensity = 1.35;
    paperFlame.update();
    const ash = cutoutMaterial(canvasTexture(drawAshFlake(4)), .25);
    const ghost = cutoutMaterial(canvasTexture(drawGhost()), .9);
    const confetti = cutoutMaterial(canvasTexture(drawConfetti(PALETTE.paper)), .6);
    const snow = paintMaterial(canvasTexture(drawSnowflake(), { softAlpha: true }), true);
    (confetti as pc.StandardMaterial).diffuseMap = null;
    this.specs = {
      breath: { material: breath },
      flame: { material: flame },
      paperFlame: { material: paperFlame },
      ember: { material: ember },
      spark: { material: spark },
      smoke: { material: smoke },
      dust: { material: dust },
      ash: { material: ash, shadows: true },
      ghost: { material: ghost, shadows: true },
      confetti: { material: confetti },
      snow: { material: snow }
    };
    this.confettiMaterials = [PALETTE.berry, PALETTE.saffron, PALETTE.teal, PALETTE.rust, PALETTE.paper, PALETTE.plum]
      .map(colour => cutoutMaterial(canvasTexture(drawConfetti(colour)), .6));

    for (let i = 0; i < lightCount; i++) {
      const entity = new pc.Entity('Fire light');
      entity.addComponent('light', {
        type: 'omni',
        color: new pc.Color(1, .42, .14),
        intensity: 0,
        range: 11,
        castShadows: false,
        falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED
      });
      root.addChild(entity);
      this.lights.push({ entity, target: null, strength: 0, seed: i * 1.7 });
    }
  }

  private readonly confettiMaterials: pc.Material[];

  get count() {
    return this.live.length;
  }

  countOf(kind: ParticleKind) {
    let n = 0;
    for (const p of this.live) if (p.kind === kind) n++;
    return n;
  }

  spawn(
    kind: ParticleKind,
    position: pc.Vec3,
    velocity: pc.Vec3,
    options: { life?: number; size?: number; spin?: number; drag?: number; gravity?: number; grow?: number; stretch?: number } = {}
  ) {
    const pool = this.pools.get(kind) ?? [];
    this.pools.set(kind, pool);
    let entity = pool.pop();
    if (!entity) {
      entity = new pc.Entity(`fx:${kind}`);
      entity.addComponent('render', {
        meshInstances: [new pc.MeshInstance(centredQuadMesh(), this.specs[kind].material)],
        castShadows: this.specs[kind].shadows ?? false,
        receiveShadows: false
      });
      this.root.addChild(entity);
    }
    if (kind === 'confetti') {
      entity.render!.meshInstances[0].material = this.confettiMaterials[Math.floor(Math.random() * this.confettiMaterials.length)];
    }
    entity.enabled = true;
    entity.setPosition(position);
    const life = options.life ?? 1;
    this.live.push({
      entity,
      kind,
      velocity: velocity.clone(),
      life,
      maxLife: life,
      size: options.size ?? 1,
      spin: options.spin ?? 0,
      angle: Math.random() * 360,
      drag: options.drag ?? 0,
      gravity: options.gravity ?? 0,
      grow: options.grow ?? 0,
      stretch: options.stretch ?? 1
    });
  }

  /**
   * One puff of breath: crisp paper flames riding a soft glowing core, with
   * sparks and the odd curl of smoke. Paper flames carry the storybook look;
   * the additive core is what makes the bloom glow.
   */
  breath(origin: pc.Vec3, forward: pc.Vec3, drakeVelocity: pc.Vec3) {
    for (let i = 0; i < 3; i++) {
      const spread = new pc.Vec3((Math.random() - .5) * .3, (Math.random() - .3) * .18, (Math.random() - .5) * .3);
      const velocity = forward.clone().add(spread).normalize().mulScalar(14 + Math.random() * 7).add(drakeVelocity);
      this.spawn('paperFlame', origin, velocity, { life: .5 + Math.random() * .25, size: .35 + Math.random() * .25, grow: 2.4, drag: 1.3, gravity: -4, spin: (Math.random() - .5) * 500, stretch: 1.3 });
    }
    const core = forward.clone().add(new pc.Vec3((Math.random() - .5) * .2, 0, (Math.random() - .5) * .2)).normalize().mulScalar(15 + Math.random() * 5).add(drakeVelocity);
    this.spawn('breath', origin, core, { life: .45, size: .55, grow: 3, drag: 1.4, gravity: -3, spin: (Math.random() - .5) * 200 });
    if (Math.random() < .7) {
      const velocity = forward.clone().mulScalar(10 + Math.random() * 8).add(new pc.Vec3((Math.random() - .5) * 5, Math.random() * 4, (Math.random() - .5) * 5));
      this.spawn('spark', origin, velocity, { life: .8, size: .1, drag: .8, gravity: 6 });
    }
    if (Math.random() < .25) {
      this.spawn('smoke', origin.clone().add(forward.clone().mulScalar(6)), forward.clone().mulScalar(3).add(new pc.Vec3(0, 2, 0)), { life: 1.3, size: .7, grow: 1.6, drag: .6, gravity: -1.2, spin: 40 });
    }
  }

  /** Continuous fire on a burning thing. Call per frame with intensity 0..1. */
  burn(at: pc.Vec3, radius: number, height: number, intensity: number, dt: number) {
    const rate = intensity * (14 + radius * 16);
    let n = rate * dt;
    while (n > 0) {
      if (Math.random() < n) {
        const p = at.clone().add(new pc.Vec3((Math.random() - .5) * radius * 2, Math.random() * height, (Math.random() - .5) * radius * 2));
        const paper = Math.random() < .75;
        this.spawn(paper ? 'paperFlame' : 'flame', p, new pc.Vec3((Math.random() - .5) * .6, 1.6 + Math.random() * 1.8, (Math.random() - .5) * .6), {
          life: .45 + Math.random() * .45,
          size: (paper ? .95 : .8) * (.6 + radius * .35) * (.6 + intensity * .6),
          grow: paper ? -.6 : .4,
          stretch: paper ? 1.4 : 1.5
        });
      }
      n -= 1;
    }
    if (Math.random() < intensity * dt * 7) {
      this.spawn('ember', at.clone().add(new pc.Vec3((Math.random() - .5) * radius, height * Math.random(), (Math.random() - .5) * radius)),
        new pc.Vec3((Math.random() - .5) * 2, 2.5 + Math.random() * 3, (Math.random() - .5) * 2), { life: 1.8, size: .09, drag: .3, gravity: -.6 });
    }
    if (Math.random() < intensity * dt * 3.5) {
      this.spawn('smoke', at.clone().add(new pc.Vec3(0, height * 1.1, 0)), new pc.Vec3((Math.random() - .5) * .8, 2.2, (Math.random() - .5) * .8),
        { life: 2.6, size: .8 + radius * .4, grow: 1.2, drag: .2, spin: 30 });
    }
    if (Math.random() < intensity * dt * 2.5) {
      this.spawn('ash', at.clone().add(new pc.Vec3(0, height, 0)), new pc.Vec3((Math.random() - .5) * 2, 2 + Math.random() * 2, (Math.random() - .5) * 2),
        { life: 3, size: .22, drag: .9, gravity: .7, spin: 280 });
    }
  }

  /** Comic burst: confetti and dust, for launches and flattenings. */
  burst(at: pc.Vec3, amount: number, withConfetti = true) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 5;
      if (withConfetti) {
        this.spawn('confetti', at, new pc.Vec3(Math.cos(a) * s, 4 + Math.random() * 5, Math.sin(a) * s),
          { life: 1.6 + Math.random(), size: .16 + Math.random() * .1, drag: 1.2, gravity: 6, spin: (Math.random() - .5) * 900 });
      }
      if (i % 2 === 0) {
        this.spawn('dust', at.clone().add(new pc.Vec3(0, .3, 0)), new pc.Vec3(Math.cos(a) * s * .6, .6, Math.sin(a) * s * .6),
          { life: .7, size: .9, grow: 1.4, drag: 2.4 });
      }
    }
  }

  /**
   * Paper snow around the camera, at `rate` flakes a second. Flakes spawn in
   * a box above and ahead of the view, so the weather is only where it can
   * be seen.
   */
  snowfall(camera: pc.Entity, rate: number, dt: number) {
    let n = rate * dt;
    const at = camera.getPosition();
    const forward = camera.forward;
    while (n > 0) {
      if (Math.random() < n) {
        const p = new pc.Vec3(
          at.x + forward.x * 14 + (Math.random() - .5) * 44,
          at.y + 6 + Math.random() * 10,
          at.z + forward.z * 14 + (Math.random() - .5) * 44
        );
        this.spawn('snow', p, new pc.Vec3((Math.random() - .5) * .8, -1.6 - Math.random() * .9, (Math.random() - .5) * .8),
          { life: 9, size: .16 + Math.random() * .14, drag: 0, gravity: 0, spin: (Math.random() - .5) * 140 });
      }
      n -= 1;
    }
  }

  ghost(at: pc.Vec3) {
    this.spawn('ghost', at.clone().add(new pc.Vec3(0, .8, 0)), new pc.Vec3(0, 1.1, 0), { life: 3.2, size: .8, drag: 0, spin: 0 });
    for (let i = 0; i < 10; i++) {
      this.spawn('ash', at.clone().add(new pc.Vec3(0, .6, 0)), new pc.Vec3((Math.random() - .5) * 3, 2 + Math.random() * 3, (Math.random() - .5) * 3),
        { life: 2, size: .2, drag: 1, gravity: 1.5, spin: 400 });
    }
  }

  /** Point a pool light at a fire. Lights are shared; the brightest fires win. */
  assignLights(fires: { position: pc.Vec3; strength: number }[]) {
    const sorted = fires.slice().sort((a, b) => b.strength - a.strength);
    this.lights.forEach((light, i) => {
      const fire = sorted[i];
      light.target = fire ? fire.position : null;
      light.strength = fire ? fire.strength : 0;
    });
  }

  update(dt: number, camera: pc.Entity, elapsed: number) {
    this.cameraRotation.copy(camera.getRotation());
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.entity.enabled = false;
        this.pools.get(p.kind)!.push(p.entity);
        this.live[i] = this.live[this.live.length - 1];
        this.live.pop();
        continue;
      }
      const damping = Math.max(0, 1 - p.drag * dt);
      p.velocity.mulScalar(damping);
      p.velocity.y -= p.gravity * dt;
      const position = p.entity.getPosition();
      this.scratch.copy(p.velocity).mulScalar(dt).add(position);
      if (this.scratch.y < .02 && p.gravity > 0) {
        this.scratch.y = .02;
        p.velocity.set(p.velocity.x * .3, 0, p.velocity.z * .3);
        p.spin *= .2;
      }
      // Snow settles into the page rather than falling through it.
      if (p.kind === 'snow' && this.scratch.y < .05) p.life = 0;
      p.entity.setPosition(this.scratch);
      p.angle += p.spin * dt;
      const t = 1 - p.life / p.maxLife;
      let scale = p.size * (1 + p.grow * t);
      if (p.kind === 'flame' || p.kind === 'paperFlame' || p.kind === 'breath' || p.kind === 'ember' || p.kind === 'spark') {
        scale *= Math.sin(Math.min(1, t * 1.15) * Math.PI) * .9 + .1;
      } else if (p.kind === 'smoke' || p.kind === 'dust') {
        scale *= 1 - t * t;
      } else if (p.kind === 'ghost') {
        scale *= Math.min(1, t * 6) * (1 - Math.pow(t, 6));
        this.scratch.x += Math.sin(elapsed * 3 + p.maxLife) * .004;
      }
      this.spinQuat.setFromEulerAngles(0, 0, p.angle);
      p.entity.setRotation(this.cameraRotation.clone().mul(this.spinQuat));
      p.entity.setLocalScale(scale, scale * p.stretch, scale);
    }

    for (const light of this.lights) {
      const component = light.entity.light!;
      if (!light.target || light.strength <= 0) {
        component.intensity = Math.max(0, component.intensity - dt * 8);
        if (component.intensity === 0) light.entity.enabled = false;
        continue;
      }
      light.entity.enabled = true;
      light.entity.setPosition(light.target.x, light.target.y + 1.6, light.target.z);
      const flicker = .75 + Math.sin(elapsed * 17 + light.seed) * .12 + Math.sin(elapsed * 31 + light.seed * 3) * .08 + Math.random() * .08;
      component.intensity = pc.math.lerp(component.intensity, light.strength * 3.2 * flicker, Math.min(1, dt * 10));
    }
  }

  clear() {
    for (const p of this.live) {
      p.entity.enabled = false;
      this.pools.get(p.kind)!.push(p.entity);
    }
    this.live.length = 0;
    this.assignLights([]);
  }
}
