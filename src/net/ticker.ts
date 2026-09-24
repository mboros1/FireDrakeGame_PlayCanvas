/**
 * A repeating timer that keeps time in a background tab.
 *
 * Browsers throttle main-thread timers in hidden tabs to once a second or
 * less, which would turn a hosting player's room into a slideshow the moment
 * they switch tabs. Timers inside a dedicated worker are not throttled that
 * way, so the room's clock lives in a tiny worker that only says "tick"; the
 * work itself still runs on the main thread, where the room is. Where no
 * worker can be made (Node, a strict embed), a plain interval stands in.
 */

export function every(ms: number, fn: () => void): () => void {
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
    try {
      const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }));
      const worker = new Worker(url);
      worker.onmessage = () => fn();
      return () => {
        worker.terminate();
        URL.revokeObjectURL(url);
      };
    } catch {
      // Fall through to a plain interval.
    }
  }
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
}
