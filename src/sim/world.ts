/**
 * Entity store. This module must never import `playcanvas`.
 *
 * A sparse set: stable generation-checked handles on the outside, dense arrays
 * on the inside. `World` owns mutation; `WorldState` is the narrow read surface
 * the view layer receives.
 *
 * The internal layout is deliberately *not* a mirror of forge's
 * `SoaStore`/`Slab`. Per `docs/ARCHITECTURE.md`, what has to stay stable is the
 * boundary — a dense transform buffer plus handle-addressed queries. Phase 3
 * replaces the implementation with a view over WASM linear memory and the
 * renderer does not change.
 */

import {
  EntityFlags,
  EntityKind,
  TRANSFORM_STRIDE,
  type EntityId,
  type Transform,
  type WorldState
} from './types';

/** Slots are 24 bits, generations the rest — comfortably inside 2^53. */
const SLOT_BITS = 24;
const SLOT_MASK = (1 << SLOT_BITS) - 1;
const GENERATION_SCALE = 2 ** SLOT_BITS;

/**
 * Generations start at 1, so no live id is ever 0 — the same reason forge's
 * `EntityId` is `NonZeroU64`. Lets 0 serve as "no entity".
 */
const FIRST_GENERATION = 1;

export const NO_ENTITY = 0 as EntityId;

const packId = (slot: number, generation: number) =>
  (slot + generation * GENERATION_SCALE) as EntityId;

const slotOf = (id: EntityId) => id & SLOT_MASK;
const generationOf = (id: EntityId) => Math.floor(id / GENERATION_SCALE);

export class World {
  private capacity = 0;
  private count = 0;

  // Dense, index 0..count-1. Iteration order is not stable across destroys.
  private posX = new Float64Array(0);
  private posY = new Float64Array(0);
  private posZ = new Float64Array(0);
  private yaw = new Float64Array(0);
  private kinds = new Uint8Array(0);
  private flagBits = new Uint32Array(0);
  private denseToSlot = new Uint32Array(0);

  // Sparse, indexed by slot.
  private slotToDense: number[] = [];
  private generations: number[] = [];
  private freeSlots: number[] = [];

  private exported = new Float32Array(0);
  private level = 'none';

  // ── Mutation ────────────────────────────────────────────────────────────

  spawn(kind: EntityKind, x: number, y: number, z: number, yaw = 0): EntityId {
    if (this.count === this.capacity) this.grow();

    const slot = this.freeSlots.pop() ?? this.generations.length;
    if (slot > SLOT_MASK) throw new Error('World: slot space exhausted');
    if (slot === this.generations.length) this.generations.push(FIRST_GENERATION);

    const dense = this.count++;
    this.posX[dense] = x;
    this.posY[dense] = y;
    this.posZ[dense] = z;
    this.yaw[dense] = yaw;
    this.kinds[dense] = kind;
    this.flagBits[dense] = EntityFlags.None;
    this.denseToSlot[dense] = slot;
    this.slotToDense[slot] = dense;

    return packId(slot, this.generations[slot]);
  }

  /** Returns false if `id` was already stale. */
  destroy(id: EntityId): boolean {
    const dense = this.denseIndex(id);
    if (dense < 0) return false;

    const last = --this.count;
    if (dense !== last) {
      // Swap-remove: move the last entity into the hole and repoint its slot.
      this.posX[dense] = this.posX[last];
      this.posY[dense] = this.posY[last];
      this.posZ[dense] = this.posZ[last];
      this.yaw[dense] = this.yaw[last];
      this.kinds[dense] = this.kinds[last];
      this.flagBits[dense] = this.flagBits[last];
      const movedSlot = this.denseToSlot[last];
      this.denseToSlot[dense] = movedSlot;
      this.slotToDense[movedSlot] = dense;
    }

    const slot = slotOf(id);
    // Bumping the generation is what makes every outstanding copy of this id
    // stale, so a recycled slot can never be mistaken for the entity that used
    // to live in it.
    this.generations[slot]++;
    this.slotToDense[slot] = -1;
    this.freeSlots.push(slot);
    return true;
  }

  setPosition(id: EntityId, x: number, y: number, z: number): void {
    const dense = this.denseIndex(id);
    if (dense < 0) return;
    this.posX[dense] = x;
    this.posY[dense] = y;
    this.posZ[dense] = z;
  }

  setYaw(id: EntityId, yaw: number): void {
    const dense = this.denseIndex(id);
    if (dense >= 0) this.yaw[dense] = yaw;
  }

  setFlags(id: EntityId, flags: number): void {
    const dense = this.denseIndex(id);
    if (dense >= 0) this.flagBits[dense] = flags;
  }

  addFlag(id: EntityId, flag: EntityFlags): void {
    const dense = this.denseIndex(id);
    if (dense >= 0) this.flagBits[dense] |= flag;
  }

  clearFlag(id: EntityId, flag: EntityFlags): void {
    const dense = this.denseIndex(id);
    if (dense >= 0) this.flagBits[dense] &= ~flag;
  }

  setLevel(name: string): void {
    this.level = name;
  }

  /** Drop every entity. Level transitions rebuild from scratch. */
  clear(): void {
    for (let dense = 0; dense < this.count; dense++) {
      const slot = this.denseToSlot[dense];
      this.generations[slot]++;
      this.slotToDense[slot] = -1;
      this.freeSlots.push(slot);
    }
    this.count = 0;
  }

  // ── Dense access, for simulation systems ────────────────────────────────
  //
  // Systems iterate `0..size()` directly rather than through handles: the hot
  // path should not pay a sparse lookup per entity per tick.

  size(): number {
    return this.count;
  }

  kindAt(dense: number): EntityKind {
    return this.kinds[dense];
  }

  flagsAt(dense: number): number {
    return this.flagBits[dense];
  }

  xAt(dense: number): number {
    return this.posX[dense];
  }

  yAt(dense: number): number {
    return this.posY[dense];
  }

  zAt(dense: number): number {
    return this.posZ[dense];
  }

  yawAt(dense: number): number {
    return this.yaw[dense];
  }

  idAt(dense: number): EntityId {
    const slot = this.denseToSlot[dense];
    return packId(slot, this.generations[slot]);
  }

  setAt(dense: number, x: number, y: number, z: number, yaw: number): void {
    this.posX[dense] = x;
    this.posY[dense] = y;
    this.posZ[dense] = z;
    this.yaw[dense] = yaw;
  }

  setFlagsAt(dense: number, flags: number): void {
    this.flagBits[dense] = flags;
  }

  // ── Read surface ────────────────────────────────────────────────────────

  /** The narrow interface handed to the view layer. */
  readonly state: WorldState = {
    entityCount: () => this.count,
    transforms: () => this.exportTransforms(),
    idsAt: (slot: number) => this.idAt(slot),
    kind: (id: EntityId) => {
      const dense = this.denseIndex(id);
      return dense < 0 ? EntityKind.Drake : this.kinds[dense];
    },
    flags: (id: EntityId) => {
      const dense = this.denseIndex(id);
      return dense < 0 ? EntityFlags.None : this.flagBits[dense];
    },
    transform: (id: EntityId, out: Transform) => {
      const dense = this.denseIndex(id);
      if (dense < 0) return false;
      out.x = this.posX[dense];
      out.y = this.posY[dense];
      out.z = this.posZ[dense];
      out.yaw = this.yaw[dense];
      return true;
    },
    levelName: () => this.level
  };

  isLive(id: EntityId): boolean {
    return this.denseIndex(id) >= 0;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private denseIndex(id: EntityId): number {
    const slot = slotOf(id);
    if (slot >= this.generations.length) return -1;
    if (this.generations[slot] !== generationOf(id)) return -1;
    const dense = this.slotToDense[slot];
    return dense === undefined || dense < 0 ? -1 : dense;
  }

  /**
   * Rebuilt each call rather than maintained incrementally. Converting yaw to
   * a quaternion here keeps rotation representation an internal detail — the
   * boundary is the documented `[x, y, z, qx, qy, qz, qw]` layout regardless
   * of how the simulation stores it.
   */
  private exportTransforms(): Float32Array {
    const needed = this.count * TRANSFORM_STRIDE;
    if (this.exported.length < needed) {
      // Reallocation is deliberate and mirrors WASM memory growth detaching
      // `memory.buffer`. Callers must not retain this array across frames.
      this.exported = new Float32Array(Math.max(needed, 64 * TRANSFORM_STRIDE));
    }
    const out = this.exported;
    for (let dense = 0; dense < this.count; dense++) {
      const base = dense * TRANSFORM_STRIDE;
      out[base] = this.posX[dense];
      out[base + 1] = this.posY[dense];
      out[base + 2] = this.posZ[dense];
      // Rotation about Y only: characters are axis-locked and never tip.
      const half = (this.yaw[dense] * Math.PI) / 360;
      out[base + 3] = 0;
      out[base + 4] = Math.sin(half);
      out[base + 5] = 0;
      out[base + 6] = Math.cos(half);
    }
    return out;
  }

  private grow(): void {
    const next = this.capacity === 0 ? 64 : this.capacity * 2;
    const copyF64 = (src: Float64Array) => {
      const dst = new Float64Array(next);
      dst.set(src);
      return dst;
    };
    this.posX = copyF64(this.posX);
    this.posY = copyF64(this.posY);
    this.posZ = copyF64(this.posZ);
    this.yaw = copyF64(this.yaw);
    const kinds = new Uint8Array(next);
    kinds.set(this.kinds);
    this.kinds = kinds;
    const flags = new Uint32Array(next);
    flags.set(this.flagBits);
    this.flagBits = flags;
    const slots = new Uint32Array(next);
    slots.set(this.denseToSlot);
    this.denseToSlot = slots;
    this.capacity = next;
  }
}
