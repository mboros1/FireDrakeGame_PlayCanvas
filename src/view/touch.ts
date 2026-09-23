/**
 * Touch controls for phones and tablets, in the storybook's cut-paper style.
 *
 * - **Left thumb:** a floating joystick. It appears wherever the thumb lands
 *   on the left half of the screen. Analog: a light push prowls, and pushing
 *   to the rim charges.
 * - **Right thumb:** drag anywhere on the right half to look around.
 * - **Buttons**, bottom right: breathe fire (hold) and charge (hold).
 * - **Two fingers:** pinch to zoom.
 *
 * Output is the same `Input` fields the keyboard produces, so the simulation
 * and multiplayer never know which device drove the drake. Only created on
 * touch-capable devices; on a desktop none of this exists.
 */

type Stick = { id: number; originX: number; originY: number; x: number; y: number };
type Look = { id: number; x: number; y: number };

/** Joystick radius in CSS pixels; pushing past CHARGE_AT of it charges. */
const STICK_RADIUS = 58;
const CHARGE_AT = .92;
const DEADZONE = .12;
/** Degrees of camera turn per CSS pixel dragged. */
const LOOK_SENSITIVITY = .32;

export const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) &&
  !window.matchMedia?.('(pointer: fine)').matches;

export class TouchControls {
  /** -1..1, camera-relative, like W/S and A/D. */
  forward = 0;
  right = 0;
  charging = false;
  breathing = false;
  /** Accumulated look since the last {@link consumeLook}, in degrees. */
  private lookYaw = 0;
  private lookPitch = 0;
  private zoom = 0;

  private stick: Stick | null = null;
  private look: Look | null = null;
  private readonly pinch = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private fireHeld = false;
  private chargeHeld = false;

  private readonly layer: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly fire: HTMLButtonElement;
  private readonly charge: HTMLButtonElement;

  /** True once any touch has happened: the keyboard hints can go. */
  used = false;

  constructor(private readonly onFirstTouch: () => void, extras: { mute: () => void; restart: () => void }) {
    document.body.classList.add('touch');
    const prompt = document.querySelector('.cover-prompt');
    if (prompt) prompt.textContent = 'tap anywhere to open the book';
    this.layer = element('div', 'touch-layer');
    this.base = element('div', 'touch-stick');
    this.knob = element('div', 'touch-knob');
    this.base.appendChild(this.knob);
    this.fire = element('button', 'touch-button touch-fire', '<span>Breathe</span>');
    this.charge = element('button', 'touch-button touch-charge', '<span>Charge</span>');
    const mute = element('button', 'touch-small touch-mute', '♪');
    const restart = element('button', 'touch-small touch-restart', '↺');
    mute.setAttribute('aria-label', 'Mute');
    restart.setAttribute('aria-label', 'Start the chapter over');
    this.layer.append(this.base, this.fire, this.charge, mute, restart);
    document.body.appendChild(this.layer);

    this.hold(this.fire, held => { this.fireHeld = held; });
    this.hold(this.charge, held => { this.chargeHeld = held; });
    tap(mute, extras.mute);
    tap(restart, extras.restart);

    this.layer.addEventListener('pointerdown', event => this.down(event));
    this.layer.addEventListener('pointermove', event => this.move(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.layer.addEventListener(type, event => this.up(event));
    }
    // No page scroll, no double-tap zoom, no long-press menu: it is a game.
    this.layer.addEventListener('touchmove', event => event.preventDefault(), { passive: false });
    this.layer.addEventListener('contextmenu', event => event.preventDefault());
  }

  /** Show or hide the controls: hidden on the cover and between chapters. */
  setVisible(visible: boolean) {
    this.layer.classList.toggle('hidden', !visible);
    if (!visible) this.release();
  }

  /** Camera look and zoom gathered since last frame. */
  consumeLook() {
    const out = { yaw: this.lookYaw, pitch: this.lookPitch, zoom: this.zoom };
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.zoom = 0;
    return out;
  }

  update() {
    if (this.stick) {
      let dx = (this.stick.x - this.stick.originX) / STICK_RADIUS;
      let dy = (this.stick.y - this.stick.originY) / STICK_RADIUS;
      const length = Math.hypot(dx, dy);
      if (length > 1) {
        dx /= length;
        dy /= length;
      }
      const amount = Math.min(1, length);
      const live = amount > DEADZONE;
      this.right = live ? dx : 0;
      this.forward = live ? -dy : 0;
      this.charging = this.chargeHeld || amount >= CHARGE_AT;
      this.knob.style.transform = `translate(${dx * STICK_RADIUS}px, ${dy * STICK_RADIUS}px)`;
      this.base.classList.toggle('charging', this.charging);
    } else {
      this.forward = 0;
      this.right = 0;
      this.charging = this.chargeHeld;
    }
    this.breathing = this.fireHeld;
  }

  private down(event: PointerEvent) {
    if (event.target !== this.layer) return;
    this.firstTouch();
    this.layer.setPointerCapture?.(event.pointerId);
    const leftHalf = event.clientX < window.innerWidth * .45;
    if (leftHalf && !this.stick) {
      this.stick = { id: event.pointerId, originX: event.clientX, originY: event.clientY, x: event.clientX, y: event.clientY };
      this.base.style.left = `${event.clientX}px`;
      this.base.style.top = `${event.clientY}px`;
      this.base.classList.add('active');
      this.knob.style.transform = 'translate(0, 0)';
      return;
    }
    if (!this.look) {
      this.look = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
    this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinch.size === 2) this.pinchDistance = this.spread();
  }

  private move(event: PointerEvent) {
    if (this.stick?.id === event.pointerId) {
      this.stick.x = event.clientX;
      this.stick.y = event.clientY;
      return;
    }
    if (this.pinch.has(event.pointerId)) {
      this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pinch.size === 2) {
        // Two fingers on the right: pinch zoom, and no look while pinching.
        const spread = this.spread();
        this.zoom += (this.pinchDistance - spread) * .04;
        this.pinchDistance = spread;
        return;
      }
    }
    if (this.look?.id === event.pointerId) {
      this.lookYaw -= (event.clientX - this.look.x) * LOOK_SENSITIVITY;
      this.lookPitch += (event.clientY - this.look.y) * LOOK_SENSITIVITY;
      this.look.x = event.clientX;
      this.look.y = event.clientY;
    }
  }

  private up(event: PointerEvent) {
    if (this.stick?.id === event.pointerId) {
      this.stick = null;
      this.base.classList.remove('active', 'charging');
    }
    if (this.look?.id === event.pointerId) this.look = null;
    this.pinch.delete(event.pointerId);
  }

  private spread() {
    const [a, b] = [...this.pinch.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private release() {
    this.stick = null;
    this.look = null;
    this.pinch.clear();
    this.fireHeld = false;
    this.chargeHeld = false;
    this.base.classList.remove('active', 'charging');
    this.fire.classList.remove('held');
    this.charge.classList.remove('held');
  }

  private hold(button: HTMLButtonElement, set: (held: boolean) => void) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      this.firstTouch();
      button.setPointerCapture?.(event.pointerId);
      button.classList.add('held');
      set(true);
    });
    const release = () => {
      button.classList.remove('held');
      set(false);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(type, release);
  }

  private firstTouch() {
    if (this.used) return;
    this.used = true;
    this.onFirstTouch();
  }
}

const element = <K extends 'div' | 'button'>(tag: K, className: string, html = ''): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  el.className = className;
  if (html) el.innerHTML = html;
  if (el instanceof HTMLButtonElement) el.type = 'button';
  return el;
};

const tap = (button: HTMLButtonElement, action: () => void) => {
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    action();
  });
};
