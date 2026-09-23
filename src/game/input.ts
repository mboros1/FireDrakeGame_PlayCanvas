/**
 * Keyboard and mouse, merged with touch into the one `Input` the simulation
 * reads. Mouse look and wheel zoom go straight to the camera rig.
 */

import type { Input } from '../sim/types';
import { TUNING } from '../tuning';
import type { TouchControls } from '../view/touch';
import type { CameraRig } from './camera';

/** Keys typed into the room form must not also drive the drake. */
const typing = (event: Event) => (event.target as HTMLElement | null)?.closest?.('input, textarea, button') != null;

export class Controls {
  readonly keys = new Set<string>();
  /** Set on the first left click: the tests read it through the debug API. */
  pointerLockRequested = false;
  touch: TouchControls | null = null;
  /** Off at the desk, where a left click places cutouts instead of locking the mouse. */
  pointerLockEnabled = true;
  /** Claim wheel events before they zoom: the desk turns and sizes cutouts with them. */
  wheelOverride: ((event: WheelEvent) => boolean) | null = null;
  private readonly input: Input = { forward: 0, right: 0, charging: false, breathing: false, cameraYaw: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly rig: CameraRig,
    hotkeys: Record<string, () => void>
  ) {
    window.addEventListener('keydown', event => {
      if (typing(event)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      if (!event.repeat) hotkeys[event.code]?.();
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('contextmenu', event => event.preventDefault());

    canvas.addEventListener('pointerdown', event => {
      // Pointer lock is a mouse idea; fingers look with the right thumb.
      if (event.button !== 0 || event.pointerType === 'touch' || !this.pointerLockEnabled) return;
      this.pointerLockRequested = true;
      void canvas.requestPointerLock()?.catch(error => {
        console.debug('Pointer lock unavailable; right-drag look remains active.', error);
      });
    });
    document.addEventListener('mousemove', event => {
      const isPointerLook = document.pointerLockElement === canvas;
      const isRightDrag = (event.buttons & 2) !== 0;
      if (!isPointerLook && !isRightDrag) return;
      rig.look(-event.movementX * TUNING.camera.mouseSensitivity, event.movementY * TUNING.camera.mouseSensitivity);
    });
    window.addEventListener('wheel', event => {
      if (this.wheelOverride?.(event)) return;
      rig.zoom(Math.sign(event.deltaY) * TUNING.camera.zoomStep * (rig.limits.maxDistance > 30 ? 4 : 1));
    }, { passive: true });
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  /** Is anything being pressed? The controls card tucks away while playing. */
  get active() {
    return this.keys.size > 0 || (this.touch?.forward ?? 0) !== 0 || (this.touch?.breathing ?? false);
  }

  get breathingHeld() {
    return this.keys.has('Space') || (this.touch?.breathing ?? false);
  }

  /** Per frame: touch look and pinch feed the camera. */
  update() {
    if (!this.touch) return;
    this.touch.update();
    const look = this.touch.consumeLook();
    this.rig.look(look.yaw, look.pitch);
    if (look.zoom !== 0) this.rig.zoom(look.zoom);
  }

  /** The tick's declared intent. Keyboard and touch sum; whichever is used wins. */
  read = (): Input => {
    const k = this.keys;
    const keyForward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const keyRight = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.input.forward = clamp(keyForward + (this.touch?.forward ?? 0));
    this.input.right = clamp(keyRight + (this.touch?.right ?? 0));
    this.input.charging = k.has('ShiftLeft') || k.has('ShiftRight') || (this.touch?.charging ?? false);
    this.input.breathing = this.breathingHeld;
    this.input.cameraYaw = this.rig.yaw;
    return this.input;
  };
}
