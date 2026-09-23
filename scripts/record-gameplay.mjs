// Scripted gameplay recording.
//
// Drives the real game with keyboard and mouse (steering through the debug
// API's lookAt hook), captures Chrome screencast frames with their real
// timestamps, and encodes recordings/fire-drake-gameplay.mp4 with ffmpeg.
//
//   npm run dev            # in another terminal, on :5173
//   npm run record
//
// Needs ffmpeg on PATH and Chrome at the path below. Headless, so no audio.
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import fs from 'fs';

const DIR = 'recordings/.frames/';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR + 'frames', { recursive: true });
const URL = process.env.FIRE_DRAKE_URL ?? 'http://127.0.0.1:5173/?quality=high';

const W = 1280, H = 720;
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const client = await page.context().newCDPSession(page);
const frames = [];
client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const n = frames.length;
  fs.writeFileSync(`${DIR}frames/${String(n).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'));
  frames.push(metadata.timestamp);
  await client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

const debug = (js, arg) => page.evaluate(js, arg);
const wait = ms => page.waitForTimeout(ms);
const state = () => debug(() => window.__FIRE_DRAKE_DEBUG__.getState());

// Steering: aim the camera at a target with the debug lookAt hook, which
// eases the yaw round like a player's mouse would. Movement is
// camera-relative, so pointing the camera is steering.
const nearest = kind => debug(k => window.__FIRE_DRAKE_DEBUG__.nearest(k), kind);
const lookAt = (x, z) => debug(([x, z]) => window.__FIRE_DRAKE_DEBUG__.lookAt(x, z), [x, z]);

const drive = async (kind, { charge = false, until = 2.2, timeout = 6000, breathe = false } = {}) => {
  let target = await nearest(kind);
  if (!target) return;
  await lookAt(target.x, target.z);
  await wait(350);
  await page.keyboard.down('KeyW');
  if (charge) await page.keyboard.down('ShiftLeft');
  if (breathe) await page.keyboard.down('Space');
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (kind === 'dwarf') target = (await nearest(kind)) ?? target;
    await lookAt(target.x, target.z);
    const s = await state();
    if (Math.hypot(target.x - s.drake.x, target.z - s.drake.z) < until) break;
    await wait(50);
  }
  if (breathe) await page.keyboard.up('Space');
  if (charge) await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
};

const aimAndBreathe = async (kind, ms, approach = 8) => {
  await drive(kind, { until: approach });
  const target = await nearest(kind);
  if (!target) return;
  await lookAt(target.x, target.z);
  // A short nudge so the drake turns its snout to where the camera looks.
  await page.keyboard.down('KeyW'); await wait(300); await page.keyboard.up('KeyW');
  await page.keyboard.down('Space');
  const start = Date.now();
  while (Date.now() - start < ms) { await lookAt(target.x, target.z); await wait(80); }
  await page.keyboard.up('Space');
};

const orbit = async (degrees, ms) => {
  const steps = Math.max(1, Math.round(ms / 50));
  const px = -degrees / 0.15 / steps;
  await page.mouse.move(W / 2, H / 2);
  await page.mouse.down({ button: 'right' });
  let x = W / 2;
  for (let i = 0; i < steps; i++) { x += px; await page.mouse.move(x, H / 2); await wait(50); }
  await page.mouse.up({ button: 'right' });
};

// ── The take ────────────────────────────────────────────────────────────────

await page.goto(URL);
await page.waitForFunction(() => window.__FIRE_DRAKE_DEBUG__?.getState().modelReady, undefined, { timeout: 60000 });
await wait(1200);
await client.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

// Cover.
await wait(2600);
await page.keyboard.press('KeyX');
await wait(2200);

// Chapter one: a stroll, a look around, a warm-up puff, then the charge for the book.
await page.keyboard.down('KeyW'); await wait(1400);
await orbit(-35, 900);
await page.keyboard.down('Space'); await wait(900); await page.keyboard.up('Space');
await orbit(35, 700);
await page.keyboard.down('ShiftLeft');
for (let i = 0; i < 60; i++) {
  const s = await state();
  if (s.scene === 'forest') break;
  await lookAt(0, -46);
  await wait(80);
}
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
await wait(2600);

// Chapter two.
await wait(2200);
await drive('dwarf', { charge: true, until: 1.4, timeout: 3500 });
await wait(900);
await aimAndBreathe('cottage', 1500, 8.5);
await wait(600);
await drive('dwarf', { charge: true, until: 1.4, timeout: 3500 });
await wait(700);
await drive('cottage', { charge: true, until: 1.2, timeout: 4000 });
await wait(1300);
await aimAndBreathe('stall', 1100, 7);
await wait(500);
await aimAndBreathe('maypole', 1400, 7);
await wait(700);
await drive('dwarf', { charge: true, until: 1.4, timeout: 3000 });
await wait(500);
await aimAndBreathe('dwarf', 900, 5);
await wait(400);
await drive('cottage', { charge: true, until: 1.2, timeout: 4000 });
await wait(900);
await aimAndBreathe('cottage', 1300, 8.5);
await wait(500);
await aimAndBreathe('haystack', 1000, 7);

// Pull back and admire the damage.
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 300); await wait(60); }
await orbit(140, 4200);
await wait(1500);

await client.send('Page.stopScreencast');
await wait(300);
const final = await state();
await browser.close();

// ffmpeg concat list with real frame durations.
let list = '';
for (let i = 0; i < frames.length; i++) {
  const duration = i + 1 < frames.length ? frames[i + 1] - frames[i] : 1 / 30;
  list += `file 'frames/${String(i).padStart(5, '0')}.jpg'\nduration ${Math.max(.005, duration).toFixed(4)}\n`;
}
list += `file 'frames/${String(frames.length - 1).padStart(5, '0')}.jpg'\n`;
fs.writeFileSync(DIR + 'list.txt', list);
console.log(JSON.stringify({ frames: frames.length, seconds: frames.at(-1) - frames[0], mayhem: final.mayhem, errors: errors.slice(0, 5) }));

execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', DIR + 'list.txt',
  '-vf', 'fps=60,format=yuv420p', '-c:v', 'libx264', '-crf', '17', '-preset', 'slow', '-movflags', '+faststart',
  'recordings/fire-drake-gameplay.mp4'], { stdio: 'inherit' });
fs.rmSync(DIR, { recursive: true, force: true });
console.log('wrote recordings/fire-drake-gameplay.mp4');
