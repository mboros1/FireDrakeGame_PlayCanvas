/**
 * Remote error reports and a session summary, sent to the room server's
 * `/report` endpoint and read with `fly logs`.
 *
 * Exists because the hardest bugs are on devices nobody here is holding: a
 * phone that picks the wrong controls, a GPU that drops frames. Sends:
 *
 * - uncaught errors, unhandled rejections and `console.error` messages,
 *   deduplicated, at most {@link MAX_REPORTS} per page;
 * - one summary after {@link SUMMARY_AFTER_MS} of play: build, device, screen,
 *   input mode, quality, frame rate.
 *
 * No player names, room codes or positions. Off with `?telemetry=0`; off in
 * automated runs unless `?telemetry=1`.
 */

const MAX_REPORTS = 20;
const SUMMARY_AFTER_MS = 20_000;

export type Telemetry = {
  /** Call once per rendered frame with its duration in seconds. */
  frame(dt: number): void;
  /** Merge fields into the next summary: scene, touch, quality. */
  note(fields: Record<string, string | number | boolean>): void;
};

export function startTelemetry(serverUrl: string, build: string, params: URLSearchParams): Telemetry {
  const setting = params.get('telemetry');
  const enabled = setting === '1' || (setting !== '0' && !navigator.webdriver);
  const endpoint = reportUrl(serverUrl);
  const noted: Record<string, string | number | boolean> = {};
  const frames: number[] = [];
  const seen = new Set<string>();
  let sent = 0;
  let summarised = false;
  const started = performance.now();

  const send = (kind: string, fields: Record<string, unknown>) => {
    if (!enabled || !endpoint || sent >= MAX_REPORTS) return;
    sent++;
    const body = JSON.stringify({ kind, build, ...fields });
    try {
      if (!navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'text/plain' }))) {
        void fetch(endpoint, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, keepalive: true }).catch(() => {});
      }
    } catch {
      // Reporting must never be the thing that breaks the game.
    }
  };

  const error = (message: string, detail: Record<string, unknown> = {}) => {
    const key = message.slice(0, 200);
    if (seen.has(key)) return;
    seen.add(key);
    send('error', { message: message.slice(0, 600), t: Math.round(performance.now() - started), ...noted, ...detail });
  };

  window.addEventListener('error', event => error(String(event.message), { source: `${event.filename}:${event.lineno}:${event.colno}` }));
  window.addEventListener('unhandledrejection', event => error(`unhandled rejection: ${String(event.reason?.message ?? event.reason)}`));
  const consoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    consoleError(...args);
    error(`console: ${args.map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeJson(a))).join(' ')}`);
  };

  const summary = () => {
    if (summarised) return;
    summarised = true;
    const sorted = frames.slice().sort((a, b) => a - b);
    const fps = sorted.length ? 1 / (sorted.reduce((s, v) => s + v, 0) / sorted.length) : 0;
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * .95)] : 0;
    send('session', {
      fps: Math.round(fps),
      slowFrameMs: Math.round(p95 * 1000),
      ua: navigator.userAgent.slice(0, 200),
      screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
      viewport: `${innerWidth}x${innerHeight}`,
      coarse: matchMedia('(pointer: coarse)').matches,
      touchPoints: navigator.maxTouchPoints,
      ...noted
    });
  };

  return {
    frame(dt) {
      frames.push(dt);
      if (frames.length > 600) frames.shift();
      if (!summarised && performance.now() - started > SUMMARY_AFTER_MS) summary();
    },
    note(fields) {
      Object.assign(noted, fields);
    }
  };
}

/** The HTTP(S) address of the room server's report endpoint. */
const reportUrl = (serverUrl: string) => {
  try {
    const url = new URL(serverUrl);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '/report';
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
};

const safeJson = (value: unknown) => {
  try {
    return JSON.stringify(value).slice(0, 200);
  } catch {
    return String(value);
  }
};
