/**
 * Simulation types. This module must never import `playcanvas`.
 *
 * See `docs/ARCHITECTURE.md` — the simulation half owns gameplay state and
 * knows nothing about rendering. Phase 3 replaces this directory with forge
 * compiled to wasm32, so what matters here is the *boundary*, not the
 * implementation behind it.
 */

declare const entityIdBrand: unique symbol;

/**
 * Opaque, stable entity identity. Mirrors the *contract* of forge's
 * `EntityId` (`forge-storage/src/entity.rs`), not its representation.
 *
 * Deliberately branded so callers cannot construct one from a number or take
 * it apart. forge states there is no public accessor on its inner bits "to
 * discourage byte-level dependence so we can change the underlying allocation
 * scheme later without breaking callers" — the same applies on this side, and
 * doubly so because the representation *will* change: JavaScript numbers carry
 * 53 bits of integer precision and a real `u64` id cannot round-trip through
 * one. When ids genuinely originate in Rust this becomes two `u32` lanes.
 *
 * Generation-checked: an id belonging to a destroyed entity never resolves,
 * even after its slot is recycled. Without that, a despawned dwarf's id would
 * silently start referring to whichever entity next took its slot, and the
 * renderer would keep drawing the old entity as the new one.
 */
export type EntityId = number & { readonly [entityIdBrand]: true };

export enum EntityKind {
  Drake = 0,
  Dwarf = 1,
  BreathParticle = 2
}

/** Per-entity state bits. Presentation reads these; it does not set them. */
export enum EntityFlags {
  None = 0,
  /** Dwarf is on fire: running faster, flailing, will despawn. */
  Burning = 1 << 0,
  /** Drake emitted breath this tick. */
  Breathing = 1 << 1,
  /** Entity is on the ground rather than airborne. */
  Grounded = 1 << 2
}

/** Movement state. Replicated; the client's animation graph reads it. */
export enum MoveState {
  Grounded = 0,
  Airborne = 1,
  Flying = 2,
  Stunned = 3
}

/** Out-parameter for {@link WorldState.transform}, to avoid per-call garbage. */
export interface Transform {
  x: number;
  y: number;
  z: number;
  /** Rotation about Y. Characters are axis-locked and never tip. */
  yaw: number;
}

/** Everything the player can express in one tick. */
export interface Input {
  /** -1 back, +1 forward. */
  forward: number;
  /** -1 left, +1 right. */
  right: number;
  charging: boolean;
  breathing: boolean;
  /**
   * Camera yaw in degrees. Movement is camera-relative, so the look angle is
   * a simulation *input* — which is exactly the "client sends button bits and
   * look angles, never positions" contract the netcode design depends on.
   */
  cameraYaw: number;
}

export const NO_INPUT: Input = {
  forward: 0,
  right: 0,
  charging: false,
  breathing: false,
  cameraYaw: 0
};

/** Floats per entity in the transform buffer: `[x, y, z, qx, qy, qz, qw]`. */
export const TRANSFORM_STRIDE = 7;

/**
 * Read surface over simulation state. The view layer sees only this.
 *
 * Two access patterns, because they have different cost profiles:
 *
 * - **Bulk, hot, every frame** — {@link transforms} returns one dense buffer
 *   the renderer walks linearly. Never call {@link transform} per entity in a
 *   frame loop; crossing the boundary per entity is the cost this shape exists
 *   to avoid, and it becomes a real cost once the boundary is WASM.
 * - **Random access, cold** — {@link kind}, {@link flags} and
 *   {@link transform} by handle, for the debug API, picking and targeting.
 */
export interface WorldState {
  entityCount(): number;

  /**
   * Dense `[x, y, z, qx, qy, qz, qw]` per entity, render-slot indexed.
   *
   * **Do not cache this across frames.** It is reallocated when the store
   * grows — deliberately mirroring WASM linear memory, where `memory.buffer`
   * detaches on growth and any retained view becomes unusable. Call it each
   * frame so the phase 3 swap changes nothing.
   */
  transforms(): Float32Array;

  /** Correlate a render slot back to its entity, for the `pc.Entity` pool. */
  idsAt(slot: number): EntityId;

  kind(id: EntityId): EntityKind;
  flags(id: EntityId): number;
  /** False if `id` is stale — destroyed, or from a recycled slot. */
  transform(id: EntityId, out: Transform): boolean;

  /** Scene the simulation is currently running. */
  levelName(): string;
}
