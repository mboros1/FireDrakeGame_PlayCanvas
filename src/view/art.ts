/**
 * The storybook's art, drawn with Canvas2D at startup.
 *
 * Every function returns a canvas. `paper.ts` turns canvases into textures.
 * Sizes are chosen so one texel is roughly a millimetre of card at the scale
 * the object is displayed.
 */

import { artRng, blobPath, grainOver, makeCanvas, scissorPath, valueNoise } from './paper';

export const PALETTE = {
  ink: '#2b2733',
  paper: '#fbf4e4',
  cream: '#f1e3c6',
  parchment: '#e8d3a9',
  mustard: '#e2a93b',
  saffron: '#f4c542',
  rust: '#c75b39',
  berry: '#b23a5b',
  plum: '#6f4a72',
  teal: '#2f7f7b',
  sage: '#8aa877',
  moss: '#58804f',
  pine: '#35604c',
  sky: '#86b9cc',
  bark: '#7a4b33',
  char: '#27211f',
  gold: '#f2c14e'
};

/** Cream margin that makes a cutout read as a cut-out-and-kept puppet. */
const withMargin = (
  width: number,
  height: number,
  margin: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  marginColour = PALETTE.paper
) => {
  const art = makeCanvas(width, height);
  draw(art.ctx);
  const out = makeCanvas(width, height);
  // Dilate the silhouette by stamping it around a circle, then flood it cream.
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    out.ctx.drawImage(art.canvas, Math.cos(a) * margin, Math.sin(a) * margin);
  }
  out.ctx.globalCompositeOperation = 'source-in';
  out.ctx.fillStyle = marginColour;
  out.ctx.fillRect(0, 0, width, height);
  out.ctx.globalCompositeOperation = 'source-over';
  out.ctx.drawImage(art.canvas, 0, 0);
  grainOver(out.ctx, width, height, .14);
  return out.canvas;
};

// ── Dwarves: split-pin paper puppets ──────────────────────────────────────

export type DwarfLook = { tunic: string; hat: string; beard: string; skin: string; seed: number };

export const DWARF_LOOKS: DwarfLook[] = [
  { tunic: PALETTE.teal, hat: PALETTE.berry, beard: '#e8e2d6', skin: '#f0b99a', seed: 1 },
  { tunic: PALETTE.rust, hat: PALETTE.saffron, beard: '#c8662c', skin: '#e6a987', seed: 2 },
  { tunic: PALETTE.plum, hat: PALETTE.teal, beard: '#7a4a2c', skin: '#f3c3a4', seed: 3 },
  { tunic: PALETTE.moss, hat: PALETTE.rust, beard: '#f2efe6', skin: '#d99a7b', seed: 4 },
  { tunic: PALETTE.berry, hat: PALETTE.mustard, beard: '#5c3b2a', skin: '#efb896', seed: 5 },
  { tunic: PALETTE.mustard, hat: PALETTE.plum, beard: '#d4834a', skin: '#e9ae8c', seed: 6 }
];

/** Dwarf body: boots to eyebrows. 256×320, the dwarf's feet on the bottom. */
export const drawDwarfBody = (look: DwarfLook) => withMargin(256, 320, 7, ctx => {
  const r = artRng(look.seed * 17);
  // Boots.
  ctx.fillStyle = '#4a3226';
  blobPath(ctx, 96, 300, 30, 14, r); ctx.fill();
  blobPath(ctx, 164, 300, 30, 14, r); ctx.fill();
  // Tunic: a bell.
  ctx.fillStyle = look.tunic;
  scissorPath(ctx, [[78, 170], [178, 170], [206, 292], [50, 292]], 3, r);
  ctx.fill();
  // Hem stitching.
  ctx.strokeStyle = 'rgba(255,245,220,.55)';
  ctx.setLineDash([7, 7]);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(56, 280); ctx.lineTo(200, 280); ctx.stroke();
  ctx.setLineDash([]);
  // Belt and buckle.
  ctx.fillStyle = '#3b2a22';
  scissorPath(ctx, [[62, 232], [194, 232], [197, 250], [59, 250]], 2, r); ctx.fill();
  ctx.fillStyle = PALETTE.gold;
  scissorPath(ctx, [[114, 228], [142, 228], [142, 254], [114, 254]], 2, r); ctx.fill();
  ctx.fillStyle = '#3b2a22';
  ctx.fillRect(121, 236, 14, 10);
  // Head.
  ctx.fillStyle = look.skin;
  blobPath(ctx, 128, 118, 54, 52, r); ctx.fill();
  // Ears.
  blobPath(ctx, 74, 122, 12, 16, r); ctx.fill();
  blobPath(ctx, 182, 122, 12, 16, r); ctx.fill();
  // Beard: scalloped, generous, over the tunic.
  ctx.fillStyle = look.beard;
  const beard: [number, number][] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const x = 70 + t * 116;
    beard.push([x, 128 + Math.sin(t * Math.PI) * 10]);
  }
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = 186 - t * 116;
    const scallop = Math.abs(Math.sin(t * Math.PI * 5)) * 16;
    beard.push([x, 212 + Math.sin(t * Math.PI) * 26 + scallop]);
  }
  scissorPath(ctx, beard, 3, r, 8);
  ctx.fill();
  // Moustache.
  ctx.fillStyle = look.beard;
  blobPath(ctx, 106, 142, 26, 12, r); ctx.fill();
  blobPath(ctx, 150, 142, 26, 12, r); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.18)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(128, 136); ctx.lineTo(128, 150); ctx.stroke();
  // Nose: the most important feature of any dwarf.
  ctx.fillStyle = '#e07f6e';
  blobPath(ctx, 128, 126, 17, 15, r); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  blobPath(ctx, 122, 120, 5, 4, r, 0, 0, 1); ctx.fill();
  // Eyes.
  ctx.fillStyle = PALETTE.ink;
  blobPath(ctx, 106, 104, 7, 8, r, 0, 0, 1); ctx.fill();
  blobPath(ctx, 150, 104, 7, 8, r, 0, 0, 1); ctx.fill();
  ctx.fillStyle = '#fff';
  blobPath(ctx, 108, 101, 2.5, 2.5, r, 0, 0, .5); ctx.fill();
  blobPath(ctx, 152, 101, 2.5, 2.5, r, 0, 0, .5); ctx.fill();
  // Eyebrows, bushy and faintly disapproving.
  ctx.fillStyle = look.beard;
  scissorPath(ctx, [[88, 88], [120, 84], [122, 92], [90, 96]], 2, r); ctx.fill();
  scissorPath(ctx, [[136, 84], [168, 88], [166, 96], [134, 92]], 2, r); ctx.fill();
  // Cheeks.
  ctx.fillStyle = 'rgba(224,90,90,.28)';
  blobPath(ctx, 92, 124, 11, 8, r); ctx.fill();
  blobPath(ctx, 164, 124, 11, 8, r); ctx.fill();
});

/** Floppy pointed hat, 256×256, brim along the bottom. */
export const drawDwarfHat = (look: DwarfLook) => withMargin(256, 256, 7, ctx => {
  const r = artRng(look.seed * 31);
  ctx.fillStyle = look.hat;
  scissorPath(ctx, [[62, 236], [194, 236], [168, 120], [150, 40], [210, 28], [132, 60], [100, 130]], 3, r, 10);
  ctx.fill();
  // Pom-pom.
  ctx.fillStyle = PALETTE.paper;
  blobPath(ctx, 212, 30, 16, 16, r, 7, 3); ctx.fill();
  // Brim band.
  ctx.fillStyle = 'rgba(0,0,0,.2)';
  scissorPath(ctx, [[56, 214], [200, 214], [204, 244], [52, 244]], 2, r); ctx.fill();
  ctx.fillStyle = look.hat;
  scissorPath(ctx, [[58, 218], [198, 218], [200, 240], [56, 240]], 2, r); ctx.fill();
  // A patch, because dwarves mend.
  ctx.fillStyle = 'rgba(255,240,210,.35)';
  scissorPath(ctx, [[120, 150], [146, 146], [148, 170], [122, 174]], 2, r); ctx.fill();
  ctx.strokeStyle = 'rgba(40,20,20,.45)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 2;
  ctx.strokeRect(121, 148, 26, 24);
  ctx.setLineDash([]);
});

/** Arm, 96×192, shoulder at the top with a brass split pin. */
export const drawDwarfArm = (look: DwarfLook) => withMargin(96, 192, 6, ctx => {
  const r = artRng(look.seed * 43);
  ctx.fillStyle = look.tunic;
  scissorPath(ctx, [[26, 18], [70, 18], [66, 132], [30, 132]], 2, r); ctx.fill();
  ctx.fillStyle = look.skin;
  blobPath(ctx, 48, 152, 24, 24, r); ctx.fill();
  // Thumb.
  blobPath(ctx, 70, 140, 10, 12, r); ctx.fill();
  // Split pin.
  ctx.fillStyle = '#c99a3a';
  blobPath(ctx, 48, 30, 8, 8, r, 0, 0, .5); ctx.fill();
  ctx.fillStyle = '#fbe29a';
  blobPath(ctx, 46, 28, 3, 3, r, 0, 0, .3); ctx.fill();
});

/** A little paper ghost, halo and all, for dwarves who have had enough. */
export const drawGhost = () => withMargin(160, 200, 5, ctx => {
  const r = artRng(99);
  ctx.fillStyle = '#f6f3ff';
  const pts: [number, number][] = [];
  for (let i = 0; i <= 20; i++) {
    const a = Math.PI + (i / 20) * Math.PI;
    pts.push([80 + Math.cos(a) * 52, 90 + Math.sin(a) * 58]);
  }
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push([132 - t * 104, 176 + (i % 2 ? -14 : 8)]);
  }
  scissorPath(ctx, pts, 2, r, 8);
  ctx.fill();
  ctx.fillStyle = PALETTE.ink;
  blobPath(ctx, 62, 88, 7, 10, r, 0, 0, 1); ctx.fill();
  blobPath(ctx, 98, 88, 7, 10, r, 0, 0, 1); ctx.fill();
  blobPath(ctx, 80, 118, 9, 11, r, 0, 0, 1); ctx.fill();
  ctx.strokeStyle = PALETTE.gold;
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.ellipse(80, 16, 34, 9, 0, 0, Math.PI * 2); ctx.stroke();
}, '#d9d4f0');

// ── Trees and props ─────────────────────────────────────────────────────────

/** Layered crown: dark back sheet, bright front sheet, a highlight cut. */
const layeredBlob = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  colours: [string, string, string],
  r: () => number,
  lumps: number
) => {
  ctx.fillStyle = colours[0];
  blobPath(ctx, cx, cy + 8, rx, ry, r, lumps, rx * .09, 4); ctx.fill();
  ctx.fillStyle = colours[1];
  blobPath(ctx, cx - rx * .06, cy - ry * .04, rx * .86, ry * .84, r, lumps, rx * .08, 4); ctx.fill();
  ctx.fillStyle = colours[2];
  blobPath(ctx, cx - rx * .3, cy - ry * .32, rx * .34, ry * .26, r, 0, 0, 3); ctx.fill();
};

const trunk = (ctx: CanvasRenderingContext2D, cx: number, top: number, bottom: number, width: number, r: () => number) => {
  ctx.fillStyle = PALETTE.bark;
  scissorPath(ctx, [[cx - width * .3, top], [cx + width * .3, top], [cx + width * .55, bottom], [cx - width * .55, bottom]], 3, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.2)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const x = cx + (r() - .5) * width * .4;
    ctx.beginPath(); ctx.moveTo(x, top + 20); ctx.lineTo(x + (r() - .5) * 8, bottom - 10); ctx.stroke();
  }
};

export type TreeStyle = 'lollipop' | 'pine' | 'cloud' | 'poplar';

export const TREE_COLOURS: [string, string, string][] = [
  ['#b0472f', PALETTE.rust, '#e58a5c'],
  ['#c38421', PALETTE.mustard, '#f3cf6f'],
  ['#2c6158', PALETTE.teal, '#6bb3a5'],
  ['#3f6b40', PALETTE.moss, '#9bbf7c'],
  ['#8b2d47', PALETTE.berry, '#dd7b8e']
];

/** Tree cutout, 512×768, roots on the bottom edge. */
export const drawTree = (style: TreeStyle, colours: [string, string, string], seed: number) => {
  const { canvas, ctx } = makeCanvas(512, 768);
  const r = artRng(seed);
  if (style === 'pine') {
    trunk(ctx, 256, 520, 762, 70, r);
    for (let i = 0; i < 4; i++) {
      const y = 140 + i * 120;
      const half = 110 + i * 42;
      ctx.fillStyle = colours[0];
      scissorPath(ctx, [[256, y - 130], [256 + half, y + 110], [256 - half, y + 110]], 5, r);
      ctx.fill();
      ctx.fillStyle = colours[1];
      scissorPath(ctx, [[252, y - 116], [256 + half * .78, y + 92], [256 - half * .9, y + 96]], 4, r);
      ctx.fill();
    }
    ctx.fillStyle = colours[2];
    scissorPath(ctx, [[252, 30], [290, 110], [230, 118]], 3, r); ctx.fill();
  } else if (style === 'poplar') {
    trunk(ctx, 256, 560, 762, 60, r);
    layeredBlob(ctx, 256, 330, 120, 290, colours, r, 9);
  } else if (style === 'cloud') {
    trunk(ctx, 256, 440, 762, 80, r);
    layeredBlob(ctx, 180, 330, 140, 120, colours, r, 7);
    layeredBlob(ctx, 330, 300, 150, 130, colours, r, 7);
    layeredBlob(ctx, 256, 200, 160, 140, colours, r, 8);
  } else {
    trunk(ctx, 256, 420, 762, 64, r);
    layeredBlob(ctx, 256, 260, 210, 210, colours, r, 0);
    // The lollipop swirl, cut into the front sheet.
    ctx.strokeStyle = colours[0];
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let t = 0; t < 14; t += .1) {
      const rad = t * 11;
      const x = 256 + Math.cos(t) * rad;
      const y = 260 + Math.sin(t) * rad;
      if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  grainOver(ctx, 512, 768, .16, seed);
  return canvas;
};

/** What a tree is after the story has finished with it. 256×384. */
export const drawStump = (seed: number) => {
  const { canvas, ctx } = makeCanvas(256, 384);
  const r = artRng(seed);
  ctx.fillStyle = PALETTE.char;
  scissorPath(ctx, [[96, 380], [100, 200], [80, 120], [118, 170], [124, 60], [140, 150], [168, 110], [158, 220], [164, 380]], 5, r, 10);
  ctx.fill();
  ctx.fillStyle = '#ff7a2a';
  for (let i = 0; i < 9; i++) {
    blobPath(ctx, 110 + r() * 50, 200 + r() * 170, 2 + r() * 3, 2 + r() * 3, r, 0, 0, 1);
    ctx.fill();
  }
  grainOver(ctx, 256, 384, .12, seed);
  return canvas;
};

/** Haystack, 384×320. */
export const drawHaystack = (seed: number) => withMargin(384, 320, 6, ctx => {
  const r = artRng(seed);
  ctx.fillStyle = '#c8952d';
  blobPath(ctx, 192, 210, 170, 110, r, 11, 6, 4); ctx.fill();
  ctx.fillStyle = PALETTE.saffron;
  blobPath(ctx, 186, 202, 150, 94, r, 11, 5, 4); ctx.fill();
  ctx.strokeStyle = 'rgba(140,90,20,.6)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 70; i++) {
    const x = 60 + r() * 260;
    const y = 130 + r() * 160;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - .5) * 30, y + 14 + r() * 16); ctx.stroke();
  }
  ctx.fillStyle = PALETTE.rust;
  scissorPath(ctx, [[30, 238], [354, 238], [352, 256], [32, 256]], 2, r); ctx.fill();
  ctx.fillStyle = '#c8952d';
  scissorPath(ctx, [[20, 318], [364, 318], [340, 290], [44, 290]], 3, r); ctx.fill();
});

/** Market stall with a striped awning, 512×512. */
export const drawStall = (awning: string, seed: number) => withMargin(512, 512, 7, ctx => {
  const r = artRng(seed);
  ctx.fillStyle = PALETTE.bark;
  scissorPath(ctx, [[70, 180], [90, 180], [90, 506], [70, 506]], 2, r); ctx.fill();
  scissorPath(ctx, [[422, 180], [442, 180], [442, 506], [422, 506]], 2, r); ctx.fill();
  // Counter with produce.
  ctx.fillStyle = '#9a6443';
  scissorPath(ctx, [[50, 360], [462, 360], [462, 430], [50, 430]], 3, r); ctx.fill();
  const produce = [PALETTE.rust, PALETTE.saffron, PALETTE.moss, PALETTE.berry, '#e8762d'];
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = produce[i % produce.length];
    blobPath(ctx, 80 + i * 23 + r() * 6, 348 - r() * 10, 16, 16, r, 0, 0, 2); ctx.fill();
  }
  // Cheese wheel, prominently.
  ctx.fillStyle = PALETTE.gold;
  blobPath(ctx, 370, 322, 44, 30, r); ctx.fill();
  ctx.fillStyle = '#d19b2b';
  scissorPath(ctx, [[370, 322], [414, 310], [414, 336]], 1, r); ctx.fill();
  // Awning.
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? PALETTE.paper : awning;
    const x0 = 36 + i * 55;
    scissorPath(ctx, [[x0 + 18, 60], [x0 + 73, 60], [x0 + 55, 190], [x0, 190]], 2, r); ctx.fill();
    ctx.beginPath();
    ctx.arc(x0 + 27, 190, 27, 0, Math.PI);
    ctx.fill();
  }
  // Sign.
  ctx.fillStyle = PALETTE.cream;
  scissorPath(ctx, [[176, 10], [336, 10], [336, 60], [176, 60]], 2, r); ctx.fill();
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'italic 700 30px "IM Fell English", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('Cheese!', 256, 46);
});

/** Fence panel, 512×192, pickets and rails. */
export const drawFence = (seed: number) => withMargin(512, 192, 4, ctx => {
  const r = artRng(seed);
  ctx.fillStyle = '#e8dcc0';
  for (let i = 0; i < 7; i++) {
    const x = 18 + i * 72;
    scissorPath(ctx, [[x, 186], [x + 34, 186], [x + 34, 50], [x + 17, 20], [x, 50]], 2, r); ctx.fill();
  }
  ctx.fillStyle = '#d4c49f';
  scissorPath(ctx, [[6, 80], [506, 80], [506, 100], [6, 100]], 2, r); ctx.fill();
  scissorPath(ctx, [[6, 140], [506, 140], [506, 160], [6, 160]], 2, r); ctx.fill();
}, '#b9a57e');

/** Signpost pointing everywhere at once. 256×512. */
export const drawSignpost = () => withMargin(256, 512, 6, ctx => {
  const r = artRng(5);
  ctx.fillStyle = PALETTE.bark;
  scissorPath(ctx, [[118, 506], [138, 506], [136, 60], [120, 60]], 2, r); ctx.fill();
  const signs: [number, number, string, string][] = [
    [110, -1, 'Hoard', PALETTE.rust],
    [190, 1, 'Cheese', PALETTE.teal],
    [270, -1, 'Doom', PALETTE.plum]
  ];
  ctx.font = 'italic 700 24px "IM Fell English", Georgia, serif';
  for (const [y, dir, label, colour] of signs) {
    ctx.fillStyle = colour;
    const x0 = dir > 0 ? 128 : 20;
    const x1 = dir > 0 ? 236 : 128;
    const tip = dir > 0 ? x1 + 16 : x0 - 16;
    scissorPath(ctx, dir > 0
      ? [[x0, y - 24], [x1, y - 24], [tip, y], [x1, y + 24], [x0, y + 24]]
      : [[x1, y - 24], [x0, y - 24], [tip, y], [x0, y + 24], [x1, y + 24]], 2, r);
    ctx.fill();
    ctx.fillStyle = PALETTE.paper;
    ctx.textAlign = 'center';
    ctx.fillText(label, (x0 + x1) / 2, y + 8);
  }
});

// ── Cottages ────────────────────────────────────────────────────────────────

export type CottageStyle = { wall: string; timber: string; roof: string; roofDark: string; door: string; seed: number };

export const COTTAGE_STYLES: CottageStyle[] = [
  { wall: PALETTE.cream, timber: '#6b4330', roof: PALETTE.berry, roofDark: '#842540', door: PALETTE.teal, seed: 1 },
  { wall: '#f3dcc0', timber: '#5a3a2c', roof: PALETTE.teal, roofDark: '#1f5a57', door: PALETTE.rust, seed: 2 },
  { wall: '#efe6d2', timber: '#704832', roof: PALETTE.rust, roofDark: '#8e3a22', door: PALETTE.plum, seed: 3 },
  { wall: '#f6e4c8', timber: '#4f3a30', roof: PALETTE.mustard, roofDark: '#a9731c', door: PALETTE.berry, seed: 4 }
];

const drawWindow = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number, glow: boolean) => {
  ctx.fillStyle = '#3b2a22';
  scissorPath(ctx, [[x - 6, y - 6], [x + w + 6, y - 6], [x + w + 6, y + h + 6], [x - 6, y + h + 6]], 2, r); ctx.fill();
  ctx.fillStyle = glow ? '#ffd36b' : '#f7c65a';
  scissorPath(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], 1.5, r); ctx.fill();
  ctx.fillStyle = '#3b2a22';
  ctx.fillRect(x + w / 2 - 3, y, 6, h);
  ctx.fillRect(x, y + h / 2 - 3, w, 6);
  // Window box with flowers.
  ctx.fillStyle = '#6b4330';
  ctx.fillRect(x - 10, y + h + 6, w + 20, 14);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = [PALETTE.berry, PALETTE.saffron, '#e8762d'][i % 3];
    blobPath(ctx, x - 4 + i * (w + 8) / 4, y + h + 2, 7, 7, r, 5, 2, 1); ctx.fill();
  }
};

const timbering = (ctx: CanvasRenderingContext2D, w: number, h: number, colour: string, r: () => number) => {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 14;
  ctx.lineCap = 'square';
  const beam = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.beginPath();
    ctx.moveTo(x0 + (r() - .5) * 3, y0 + (r() - .5) * 3);
    ctx.lineTo(x1 + (r() - .5) * 3, y1 + (r() - .5) * 3);
    ctx.stroke();
  };
  beam(8, 8, w - 8, 8);
  beam(8, h * .52, w - 8, h * .52);
  beam(8, h - 8, w - 8, h - 8);
  beam(8, 8, 8, h - 8);
  beam(w - 8, 8, w - 8, h - 8);
  beam(w * .5, h * .52, w * .5, h - 8);
  beam(8, h * .52, w * .25, 8);
  beam(w - 8, h * .52, w * .75, 8);
};

/**
 * Front facade: 512×640. The bottom 62% is wall, the top is the gable
 * triangle — `cottageMeshes` maps its pentagon onto exactly that split.
 */
export const drawCottageFront = (style: CottageStyle, gableFraction: number) => {
  const { canvas, ctx } = makeCanvas(512, 640);
  const r = artRng(style.seed * 7);
  const wallTop = 640 * gableFraction;
  // The whole sheet is wall-coloured; the pentagon UVs crop it.
  ctx.fillStyle = style.wall;
  ctx.fillRect(0, 0, 512, 640);
  // Gable planks.
  ctx.fillStyle = style.roofDark;
  ctx.globalAlpha = .18;
  for (let y = 20; y < wallTop; y += 28) ctx.fillRect(0, y, 512, 3);
  ctx.globalAlpha = 1;
  // Round attic window.
  ctx.fillStyle = '#3b2a22';
  blobPath(ctx, 256, wallTop * .62, 40, 40, r); ctx.fill();
  ctx.fillStyle = '#ffd36b';
  blobPath(ctx, 256, wallTop * .62, 30, 30, r); ctx.fill();
  ctx.fillStyle = '#3b2a22';
  ctx.fillRect(253, wallTop * .62 - 30, 6, 60);
  // Lower wall with timber framing.
  ctx.save();
  ctx.translate(0, wallTop);
  timbering(ctx, 512, 640 - wallTop, style.timber, r);
  // Door, arched.
  const doorW = 110;
  const doorH = 170;
  const dy = 640 - wallTop - doorH;
  ctx.fillStyle = '#3b2a22';
  ctx.beginPath();
  ctx.moveTo(256 - doorW / 2 - 8, 640 - wallTop);
  ctx.lineTo(256 - doorW / 2 - 8, dy + 50);
  ctx.arc(256, dy + 50, doorW / 2 + 8, Math.PI, 0);
  ctx.lineTo(256 + doorW / 2 + 8, 640 - wallTop);
  ctx.fill();
  ctx.fillStyle = style.door;
  ctx.beginPath();
  ctx.moveTo(256 - doorW / 2, 640 - wallTop);
  ctx.lineTo(256 - doorW / 2, dy + 50);
  ctx.arc(256, dy + 50, doorW / 2, Math.PI, 0);
  ctx.lineTo(256 + doorW / 2, 640 - wallTop);
  ctx.fill();
  ctx.fillStyle = PALETTE.gold;
  blobPath(ctx, 256 + 32, dy + 110, 6, 6, r, 0, 0, 1); ctx.fill();
  drawWindow(ctx, 60, 40, 90, 70, r, true);
  drawWindow(ctx, 362, 40, 90, 70, r, true);
  ctx.restore();
  grainOver(ctx, 512, 640, .12, style.seed);
  return canvas;
};

export const drawCottageSide = (style: CottageStyle) => {
  const { canvas, ctx } = makeCanvas(512, 320);
  const r = artRng(style.seed * 13);
  ctx.fillStyle = style.wall;
  ctx.fillRect(0, 0, 512, 320);
  timbering(ctx, 512, 320, style.timber, r);
  drawWindow(ctx, 90, 60, 90, 70, r, true);
  drawWindow(ctx, 332, 60, 90, 70, r, true);
  // Ivy.
  ctx.fillStyle = PALETTE.moss;
  for (let i = 0; i < 26; i++) {
    blobPath(ctx, 10 + r() * 60, 150 + r() * 170, 8 + r() * 6, 7 + r() * 5, r, 0, 0, 2); ctx.fill();
  }
  grainOver(ctx, 512, 320, .12, style.seed + 5);
  return canvas;
};

export const drawRoof = (style: CottageStyle) => {
  const { canvas, ctx } = makeCanvas(512, 512);
  const r = artRng(style.seed * 19);
  ctx.fillStyle = style.roofDark;
  ctx.fillRect(0, 0, 512, 512);
  // Scalloped shingles, row by row from the eave (v=0, bottom) upward.
  for (let row = 0; row < 11; row++) {
    const y = 512 - row * 48;
    for (let col = -1; col < 10; col++) {
      const x = col * 56 + (row % 2) * 28;
      ctx.fillStyle = (row + col) % 5 === 0 ? style.roofDark : style.roof;
      ctx.beginPath();
      ctx.moveTo(x, y - 48);
      ctx.lineTo(x + 54, y - 48);
      ctx.lineTo(x + 54, y - 18);
      ctx.arc(x + 27, y - 18, 27, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.15)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  // Ridge cap.
  ctx.fillStyle = style.roofDark;
  ctx.fillRect(0, 0, 512, 22);
  grainOver(ctx, 512, 512, .12, style.seed + 9);
  // Nudge: shingle rows read better with slight random darkening.
  ctx.fillStyle = 'rgba(0,0,0,.06)';
  for (let i = 0; i < 12; i++) ctx.fillRect(r() * 512, r() * 512, 56, 30);
  return canvas;
};

// ── Backdrops ───────────────────────────────────────────────────────────────

/** A strip of rolling hills that tiles horizontally. 1024×256. */
export const drawHills = (fill: string, highlight: string, seed: number, jaggy = false) => {
  const { canvas, ctx } = makeCanvas(1024, 256);
  const r = artRng(seed);
  const top = (x: number) => {
    const t = (x / 1024) * Math.PI * 2;
    const base = jaggy
      ? 120 + Math.abs(Math.sin(t * 3 + seed)) * -80 + Math.sin(t * 7) * 18
      : 120 + Math.sin(t * 2 + seed) * 40 + Math.sin(t * 5 + seed * 2) * 18;
    return base;
  };
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, 256);
  for (let x = 0; x <= 1024; x += 8) ctx.lineTo(x, top(x) + (r() - .5) * 3);
  ctx.lineTo(1024, 256);
  ctx.closePath();
  ctx.fill();
  // Highlight edge along the crest, like a lighter sheet peeking behind.
  ctx.strokeStyle = highlight;
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let x = 0; x <= 1024; x += 8) {
    const y = top(x) + 4;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  if (!jaggy) {
    // A few distant trees and a tiny windmill on the crest.
    for (let i = 0; i < 14; i++) {
      const x = r() * 1024;
      const y = top(x) + 6;
      ctx.fillStyle = fill;
      blobPath(ctx, x, y - 16, 10 + r() * 8, 14 + r() * 10, r, 0, 0, 2); ctx.fill();
    }
  }
  grainOver(ctx, 1024, 256, .1, seed);
  return canvas;
};

/** Vertical sky gradient with hand-cut cloud bands. 64×512, unlit. */
export const drawSky = (stops: [number, string][]) => {
  const { canvas, ctx } = makeCanvas(64, 512);
  const gradient = ctx.createLinearGradient(0, 512, 0, 0);
  for (const [t, c] of stops) gradient.addColorStop(t, c);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 512);
  return canvas;
};

/** Cloud on a string, 512×256. */
export const drawCloud = (seed: number) => withMargin(512, 256, 5, ctx => {
  const r = artRng(seed);
  ctx.fillStyle = '#fff7ee';
  blobPath(ctx, 170, 150, 110, 70, r, 6, 10); ctx.fill();
  blobPath(ctx, 300, 120, 130, 90, r, 7, 10); ctx.fill();
  blobPath(ctx, 390, 160, 90, 60, r, 5, 8); ctx.fill();
  ctx.fillStyle = 'rgba(210,170,170,.35)';
  blobPath(ctx, 280, 200, 190, 24, r, 0, 0, 3); ctx.fill();
}, '#f2d9cf');

/** Sun with scalloped rays and a sleepy face. 512×512. */
export const drawSun = () => withMargin(512, 512, 6, ctx => {
  const r = artRng(8);
  ctx.fillStyle = '#f49b3f';
  const rays: [number, number][] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const rad = i % 2 ? 180 : 238;
    rays.push([256 + Math.cos(a) * rad, 256 + Math.sin(a) * rad]);
  }
  scissorPath(ctx, rays, 4, r, 20); ctx.fill();
  ctx.fillStyle = PALETTE.saffron;
  blobPath(ctx, 256, 256, 150, 150, r); ctx.fill();
  ctx.fillStyle = '#fbe08a';
  blobPath(ctx, 216, 210, 50, 38, r); ctx.fill();
  // Sleepy face: it has seen dragons before.
  ctx.strokeStyle = '#a2552a';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(206, 262, 22, .2, Math.PI - .2); ctx.stroke();
  ctx.beginPath(); ctx.arc(306, 262, 22, .2, Math.PI - .2); ctx.stroke();
  ctx.beginPath(); ctx.arc(256, 320, 14, 0, Math.PI); ctx.stroke();
  ctx.fillStyle = 'rgba(230,100,80,.35)';
  blobPath(ctx, 180, 300, 20, 12, r); ctx.fill();
  blobPath(ctx, 332, 300, 20, 12, r); ctx.fill();
});

/**
 * The stage floor: 2048² paper sheet mapped to the 116 m playfield. Grass
 * paper, cut-paper paths, a pond, stitched field patches.
 */
export const drawVillageGround = (paths: [number, number][][], pond: [number, number, number]) => {
  const size = 2048;
  const { canvas, ctx } = makeCanvas(size, size);
  const r = artRng(404);
  const toPx = (m: number) => (m / 116 + .5) * size;
  ctx.fillStyle = '#7fa06a';
  ctx.fillRect(0, 0, size, size);
  // Patchwork fields.
  const fieldColours = ['#8aad72', '#739660', '#94b27a', '#6d8f5b', '#a0b97f', '#86a46b'];
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = fieldColours[i % fieldColours.length];
    const cx = r() * size;
    const cy = r() * size;
    const w = 120 + r() * 260;
    const h = 90 + r() * 200;
    const a = r() * Math.PI;
    const pts: [number, number][] = [
      [-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]
    ].map(([x, y]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]);
    scissorPath(ctx, pts, 6, r, 30);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,80,40,.35)';
    ctx.setLineDash([10, 9]);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Grass tufts.
  ctx.strokeStyle = 'rgba(60,95,50,.32)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 1400; i++) {
    const x = r() * size;
    const y = r() * size;
    ctx.beginPath();
    ctx.moveTo(x - 3, y); ctx.lineTo(x - 4, y - 6);
    ctx.moveTo(x, y); ctx.lineTo(x, y - 8);
    ctx.moveTo(x + 3, y); ctx.lineTo(x + 5, y - 5);
    ctx.stroke();
  }
  // Flowers.
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = [PALETTE.paper, PALETTE.saffron, '#e7a1b0', PALETTE.paper][i % 4];
    blobPath(ctx, r() * size, r() * size, 4, 4, r, 5, 2, .5);
    ctx.fill();
  }
  // Paths: torn parchment ribbons.
  for (const path of paths) {
    for (const [width, colour] of [[64, '#c9a878'], [50, '#e2c99a']] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      path.forEach(([x, z], i) => {
        const px = toPx(x) + (r() - .5) * 6;
        const py = toPx(z) + (r() - .5) * 6;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(140,110,70,.35)';
    for (const [x, z] of path) {
      for (let i = 0; i < 6; i++) {
        blobPath(ctx, toPx(x) + (r() - .5) * 40, toPx(z) + (r() - .5) * 40, 5, 4, r, 0, 0, 1);
        ctx.fill();
      }
    }
  }
  // Pond.
  const [px, pz, pr] = pond;
  ctx.fillStyle = '#4f8a9a';
  blobPath(ctx, toPx(px), toPx(pz), pr / 116 * size + 14, pr / 116 * size * .8 + 14, r, 7, 8, 5); ctx.fill();
  ctx.fillStyle = '#6fb0bd';
  blobPath(ctx, toPx(px), toPx(pz), pr / 116 * size, pr / 116 * size * .8, r, 7, 8, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.6)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 7; i++) {
    const x = toPx(px) + (r() - .5) * pr * 20;
    const y = toPx(pz) + (r() - .5) * pr * 12;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 30, y); ctx.stroke();
  }
  // Lily pads.
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = PALETTE.moss;
    const x = toPx(px) + (r() - .5) * pr * 22;
    const y = toPx(pz) + (r() - .5) * pr * 14;
    ctx.beginPath(); ctx.arc(x, y, 12, .4, Math.PI * 2); ctx.lineTo(x, y); ctx.fill();
  }
  grainOver(ctx, size, size, .1, 12);
  return canvas;
};

/** The lava cave floor: basalt sheets with a glowing crack network. */
export const drawCaveGround = () => {
  const size = 1024;
  const { canvas, ctx } = makeCanvas(size, size);
  const r = artRng(77);
  ctx.fillStyle = '#2a1d2b';
  ctx.fillRect(0, 0, size, size);
  const tones = ['#34233a', '#3c2638', '#2f2033', '#452a3a'];
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = tones[i % tones.length];
    const cx = r() * size;
    const cy = r() * size;
    const pts: [number, number][] = [];
    const n = 5 + Math.floor(r() * 3);
    const rad = 30 + r() * 70;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * .5;
      pts.push([cx + Math.cos(a) * rad * (.7 + r() * .5), cy + Math.sin(a) * rad * (.7 + r() * .5)]);
    }
    scissorPath(ctx, pts, 4, r, 20);
    ctx.fill();
  }
  // Gold coins scattered like someone was careless with a hoard. They were.
  for (let i = 0; i < 260; i++) {
    const x = r() * size;
    const y = r() * size;
    ctx.fillStyle = '#b98a2a';
    ctx.beginPath(); ctx.ellipse(x, y + 1.5, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PALETTE.gold;
    ctx.beginPath(); ctx.ellipse(x, y, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  grainOver(ctx, size, size, .14, 21);
  return canvas;
};

/** Emissive map for the cave floor — only the coins and embers glow. */
export const drawLavaRiver = () => {
  const { canvas, ctx } = makeCanvas(256, 1024);
  const r = artRng(9);
  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  gradient.addColorStop(0, '#ff5a1a');
  gradient.addColorStop(.5, '#ffb43a');
  gradient.addColorStop(1, '#ff5a1a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 1024);
  // Paper crust floes drifting on the lava.
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = i % 3 ? '#7a2414' : '#a8321a';
    blobPath(ctx, 30 + r() * 196, r() * 1024, 12 + r() * 26, 10 + r() * 30, r, 0, 0, 4);
    ctx.fill();
  }
  ctx.fillStyle = '#fff1a8';
  for (let i = 0; i < 60; i++) {
    blobPath(ctx, r() * 256, r() * 1024, 3 + r() * 5, 2 + r() * 4, r, 0, 0, 1);
    ctx.fill();
  }
  return canvas;
};

/** Cave backdrop: jagged rock teeth. 1024×512, tiles horizontally. */
export const drawCaveWall = (fill: string, rim: string, seed: number) => {
  const { canvas, ctx } = makeCanvas(1024, 512);
  const r = artRng(seed);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, 512);
  let x = 0;
  const points: [number, number][] = [[0, 512]];
  while (x < 1024) {
    points.push([x, 140 + r() * 180]);
    x += 30 + r() * 70;
    points.push([x, 40 + r() * 140]);
    x += 30 + r() * 60;
  }
  points.push([1024, 150], [1024, 512]);
  // Make the seam match.
  points[1][1] = 150;
  scissorPath(ctx, points, 5, r, 16);
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = 4;
  ctx.stroke();
  // Crystals.
  for (let i = 0; i < 10; i++) {
    const cx = r() * 1000;
    const cy = 300 + r() * 180;
    ctx.fillStyle = i % 2 ? '#6fd1c9' : '#b58ae0';
    scissorPath(ctx, [[cx, cy], [cx + 12, cy - 50 - r() * 30], [cx + 24, cy]], 2, r);
    ctx.fill();
  }
  grainOver(ctx, 1024, 512, .12, seed);
  return canvas;
};

/** Stalactite fringe hung from the cave's paper ceiling. 1024×256. */
export const drawStalactites = (fill: string, seed: number) => {
  const { canvas, ctx } = makeCanvas(1024, 256);
  const r = artRng(seed);
  ctx.fillStyle = fill;
  const pts: [number, number][] = [[0, 0]];
  let x = 0;
  while (x < 1024) {
    pts.push([x, 20 + r() * 20]);
    x += 20 + r() * 30;
    pts.push([x, 80 + r() * 170]);
    x += 20 + r() * 30;
  }
  pts.push([1024, 30], [1024, 0]);
  pts[1][1] = 30;
  scissorPath(ctx, pts, 4, r, 16);
  ctx.fill();
  grainOver(ctx, 1024, 256, .12, seed);
  return canvas;
};

/** The gate out of chapter one: a giant open storybook, stood on end. */
export const drawBookGate = () => withMargin(1024, 768, 8, ctx => {
  const r = artRng(55);
  // Cover.
  ctx.fillStyle = '#6d2438';
  scissorPath(ctx, [[40, 90], [984, 90], [984, 740], [40, 740]], 4, r);
  ctx.fill();
  // Pages, fanned.
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? PALETTE.cream : PALETTE.paper;
    scissorPath(ctx, [[70 + i * 6, 70 + i * 4], [508, 110 + i * 2], [508, 724], [70 + i * 6, 710 - i * 3]], 3, r);
    ctx.fill();
    scissorPath(ctx, [[954 - i * 6, 70 + i * 4], [516, 110 + i * 2], [516, 724], [954 - i * 6, 710 - i * 3]], 3, r);
    ctx.fill();
  }
  // Illuminated text on the pages.
  ctx.fillStyle = '#6d2438';
  ctx.font = '700 64px "IM Fell English SC", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('Chapter', 290, 220);
  ctx.fillText('the Second', 740, 220);
  ctx.fillStyle = 'rgba(43,39,51,.55)';
  for (let row = 0; row < 11; row++) {
    for (const cx of [290, 740]) {
      const w = 300 - (row === 10 ? 140 : r() * 30);
      ctx.fillRect(cx - 150, 280 + row * 36, w, 7);
    }
  }
  // A drop capital with a tiny dragon in it.
  ctx.fillStyle = PALETTE.gold;
  ctx.fillRect(140, 270, 76, 76);
  ctx.fillStyle = '#6d2438';
  ctx.font = '700 70px "IM Fell English SC", Georgia, serif';
  ctx.fillText('O', 178, 334);
  // Ribbon bookmark.
  ctx.fillStyle = PALETTE.gold;
  scissorPath(ctx, [[500, 40], [530, 40], [530, 760], [515, 730], [500, 760]], 2, r);
  ctx.fill();
});

// ── FX sprites ───────────────────────────────────────────────────────────────

/** Soft flame tongue, 128×192. Additive, so colour is the glow. */
export const drawFlame = (hot: string, cool: string) => {
  const { canvas, ctx } = makeCanvas(128, 192);
  const gradient = ctx.createRadialGradient(64, 140, 4, 64, 120, 90);
  gradient.addColorStop(0, hot);
  gradient.addColorStop(.45, cool);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(64, 4);
  ctx.bezierCurveTo(100, 70, 124, 110, 110, 150);
  ctx.bezierCurveTo(98, 188, 30, 188, 18, 150);
  ctx.bezierCurveTo(4, 110, 28, 70, 64, 4);
  ctx.fill();
  return canvas;
};

/**
 * Paper-cut flame: the storybook version, crisp edged. 128×192. Three
 * teardrop sheets, each with a flicked tip, stacked red → orange → yellow.
 */
export const drawPaperFlame = () => {
  const { canvas, ctx } = makeCanvas(128, 192);
  const r = artRng(41);
  const tongue = (cx: number, base: number, width: number, height: number, lean: number, colour: string) => {
    const pts: [number, number][] = [];
    const n = 28;
    for (let i = 0; i <= n; i++) {
      // Teardrop: round bottom, pinched tip that leans and flicks.
      const t = i / n;
      const a = t * Math.PI * 2;
      const bulge = Math.sin(a / 2);
      const y = base - (1 - Math.cos(a / 2)) * .5 * height;
      const x = cx + Math.sin(a) * width * .5 * Math.pow(bulge, .15) * (1 - (base - y) / height * .85) + lean * Math.pow((base - y) / height, 2.2);
      pts.push([x, y]);
    }
    ctx.fillStyle = colour;
    scissorPath(ctx, pts, 2.5, r, 7);
    ctx.fill();
  };
  tongue(64, 188, 104, 184, 18, '#e8431c');
  tongue(40, 186, 44, 110, -14, '#e8431c');
  tongue(90, 186, 44, 120, 16, '#e8431c');
  tongue(64, 184, 74, 136, 12, '#ff8a26');
  tongue(64, 180, 40, 84, 6, '#ffd35a');
  return canvas;
};

export const drawSoftDot = (inner: string, outer = 'rgba(0,0,0,0)', size = 64) => {
  const { canvas, ctx } = makeCanvas(size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
};

/** Smoke puff with a paper edge. 128×128. */
export const drawSmoke = (seed: number) => {
  const { canvas, ctx } = makeCanvas(128, 128);
  const r = artRng(seed);
  ctx.fillStyle = 'rgba(92,84,96,.72)';
  blobPath(ctx, 64, 64, 50, 46, r, 6, 6, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(140,130,140,.6)';
  blobPath(ctx, 54, 54, 26, 22, r, 0, 0, 2);
  ctx.fill();
  return canvas;
};

/** Ash flake: a curled scrap of burnt page. 64×64. */
export const drawAshFlake = (seed: number) => {
  const { canvas, ctx } = makeCanvas(64, 64);
  const r = artRng(seed);
  ctx.fillStyle = '#2d2622';
  scissorPath(ctx, [[10, 20], [50, 10], [56, 44], [18, 54]], 6, r, 8);
  ctx.fill();
  ctx.strokeStyle = '#ff8a3a';
  ctx.lineWidth = 3;
  ctx.stroke();
  return canvas;
};

/** Confetti chit for comic bursts. 32×32. */
export const drawConfetti = (colour: string) => {
  const { canvas, ctx } = makeCanvas(32, 32);
  ctx.fillStyle = colour;
  ctx.fillRect(4, 8, 24, 16);
  return canvas;
};

/** Bunting pennant, 64×96. */
export const drawPennant = (colour: string, seed: number) => {
  const { canvas, ctx } = makeCanvas(64, 96);
  const r = artRng(seed);
  ctx.fillStyle = colour;
  scissorPath(ctx, [[2, 2], [62, 2], [32, 92]], 2, r, 10);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  blobPath(ctx, 32, 24, 8, 8, r, 0, 0, 1);
  ctx.fill();
  grainOver(ctx, 64, 96, .12, seed);
  return canvas;
};

/** Plain card with grain, for strings, posts and anything tinted. */
export const drawPlainCard = (colour: string, seed = 1) => {
  const { canvas, ctx } = makeCanvas(64, 64);
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 64, 64);
  grainOver(ctx, 64, 64, .16, seed);
  return canvas;
};

/** Probability helper for scatter that avoids clumps near a point. */
export const noiseAt = (x: number, z: number) => valueNoise(x * 10, z * 10, 37, 5);

/** Dizzy star, 64×64. */
export const drawStar = () => {
  const { canvas, ctx } = makeCanvas(64, 64);
  const r = artRng(12);
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rad = i % 2 ? 12 : 28;
    pts.push([32 + Math.cos(a) * rad, 32 + Math.sin(a) * rad]);
  }
  ctx.fillStyle = PALETTE.paper;
  scissorPath(ctx, pts.map(([x, y]) => [32 + (x - 32) * 1.15, 32 + (y - 32) * 1.15] as [number, number]), 1, r, 6);
  ctx.fill();
  ctx.fillStyle = PALETTE.saffron;
  scissorPath(ctx, pts, 1, r, 6);
  ctx.fill();
  return canvas;
};

/** Maypole stripes: a barber-pole wrap for a cylinder. 128×512. */
export const drawMaypoleStripes = () => {
  const { canvas, ctx } = makeCanvas(128, 512);
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, 128, 512);
  ctx.fillStyle = PALETTE.berry;
  for (let y = -128; y < 512; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(128, y + 64); ctx.lineTo(128, y + 88); ctx.lineTo(0, y + 24);
    ctx.fill();
  }
  grainOver(ctx, 128, 512, .12, 3);
  return canvas;
};

/** Flower crown for the top of the maypole, 256×128. */
export const drawGarland = () => withMargin(256, 128, 4, ctx => {
  const r = artRng(71);
  ctx.fillStyle = PALETTE.moss;
  blobPath(ctx, 128, 70, 110, 34, r, 12, 8, 3); ctx.fill();
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = [PALETTE.berry, PALETTE.saffron, PALETTE.paper, '#e8762d'][i % 4];
    blobPath(ctx, 26 + i * 15, 60 + r() * 24, 11, 11, r, 5, 3, 1); ctx.fill();
  }
});
