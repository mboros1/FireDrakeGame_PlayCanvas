/**
 * Scalar helpers for the simulation. This module must never import
 * `playcanvas` — these replace `pc.math.*` on the sim side of the seam.
 */

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export const clamp = (value: number, min: number, max: number) =>
  value < min ? min : value > max ? max : value;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Shortest signed rotation from `from` to `to`, in degrees, always in
 * (-180, 180]. Keeps a turn from taking the long way around when the target
 * crosses the +/-180 seam.
 */
export const shortestAngleDelta = (from: number, to: number) =>
  ((to - from + 540) % 360) - 180;
