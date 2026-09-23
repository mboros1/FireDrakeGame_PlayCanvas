/**
 * The storybook's printed matter: chapter headings, the mayhem seal, the
 * narrator's running commentary, comic sound-effect pops and speech bubbles.
 *
 * Plain DOM over the canvas. Everything is `pointer-events: none` so the
 * canvas keeps every click — pointer lock and the Playwright suite rely on it.
 */

import * as pc from 'playcanvas';
import type { RampageEvent } from '../sim/rampage';
import { PropKind } from '../sim/props';
import { Deeds } from './deeds';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

export const TIERS: [number, string][] = [
  [0, 'A Perfectly Pleasant Afternoon'],
  [40, 'Some Light Arson'],
  [120, 'A Regrettable Incident'],
  [260, 'The Talk of the Shire'],
  [480, 'A Local Catastrophe'],
  [800, 'A Regional Calamity'],
  [1300, 'An Act of Dragon'],
  [2100, 'The End of the Book']
];

const LINES: Record<string, string[]> = {
  intro: [
    'Once upon a time, in a cave full of gold, there lived a drake who was frankly bored of gold.',
    'Deep in the Hoard, a drake stirred, stretched, and decided today would be different.'
  ],
  village: [
    'Meanwhile, in the village of Little Kindling, it was the day of the Great Cheese Festival.',
    'The village of Little Kindling had never once, in four hundred years, been set on fire. This was about to change.'
  ],
  dwarfIgnited: [
    'Old Barnaby had always wanted to be the centre of attention.',
    'A dwarf discovered, briefly and loudly, that beards are flammable.',
    'Someone shouted "stop, drop and roll". Nobody listened.',
    'The fire brigade, being entirely made of paper, stayed home.',
    'Hopping about did not help. It rarely does.'
  ],
  dwarfLaunched: [
    'The dwarf achieved flight, which was more than his grandfather ever managed.',
    'Up went the dwarf, and his hat, in that order.',
    'It is said that dwarves are sturdy. It was not said how far they travel.',
    'Wheeee, said the dwarf, contrary to all expectations.',
    'Gravity, as ever, had the final word.'
  ],
  dwarfRelaunched: [
    'Some dwarves never learn. This one had now learned twice.',
    'Again! cried nobody, least of all the dwarf.'
  ],
  cottage: [
    'The thatch caught, the shutters caught, and then the neighbours caught on.',
    'Mrs. Pettigrew\'s cottage had been in the family for nine generations. Well. Eight.',
    'Smoke rose from the chimney, and the walls, and the roof, and the doormat.'
  ],
  flattened: [
    'The cottage folded neatly flat, as pop-up houses do when you close the book.',
    'Crunch. The architecture was, in hindsight, mostly paper.',
    'Someone would be writing a very stern letter about this.'
  ],
  haystack: [
    'The haystacks were dry, which was really asking for it.',
    'Somewhere, a farmer wept into a very small handkerchief.'
  ],
  maypole: [
    'The maypole went up like a birthday candle. Nobody sang.',
    'And that, as they say, was the end of the festival.'
  ],
  stall: [
    'The cheese! Not the cheese!',
    'Market prices for toasted cheese fell sharply.'
  ],
  tree: [
    'The woods caught the mood.',
    'Autumn arrived early, and then very suddenly left.'
  ],
  gone: [
    'A small paper ghost floated up, looking mildly put out.',
    'And so another dwarf passed quietly into the margins.'
  ],
  combo: [
    'The chaos was, by now, self-sustaining.',
    'Historians would later call this "the bit where it all went wrong".',
    'Even the sun looked away.'
  ]
};

const SHOUTS = ['Eep!', 'My beard!', 'Not again!', 'Hot hot hot!', 'Mother!', 'Oi!', 'Aaaa!', 'The cheese!', 'Help!', 'Why me?', 'Owwww!', 'Blast!'];
const FLYING = ['Wheee!', 'Aaaaah!', 'Whoa!', 'Nooo!', 'I can see my house!'];

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

type Pop = { el: HTMLDivElement; world: pc.Vec3; life: number; maxLife: number; rise: number };

export class Hud {
  private readonly chapterNumber = $<HTMLDivElement>('#chapter-number');
  private readonly objective = $<HTMLDivElement>('#objective');
  private readonly score = $<HTMLSpanElement>('#score');
  private readonly tier = $<HTMLDivElement>('#tier');
  private readonly combo = $<HTMLDivElement>('#combo');
  private readonly mayhem = $<HTMLDivElement>('#mayhem');
  private readonly narrator = $<HTMLDivElement>('#narrator');
  private readonly popups = $<HTMLDivElement>('#popups');
  private readonly stats = $<HTMLDivElement>('#stats');
  private readonly cover = $<HTMLDivElement>('#cover');
  private readonly loading = $<HTMLDivElement>('#loading');
  private readonly controls = $<HTMLDivElement>('.controls');

  readonly deeds = new Deeds($<HTMLElement>('#deeds'));
  private readonly deedsCount = $<HTMLSpanElement>('#deeds-count');
  private readonly theEnd = $<HTMLDivElement>('#the-end');
  private ended = false;
  private readonly pops: Pop[] = [];
  private shownScore = 0;
  private tierIndex = 0;
  private narrationCooldown = 0;
  private narrationTimer = 0;
  private typing: { text: string; shown: number } | null = null;
  private readonly screen = new pc.Vec3();
  private lastLine = '';
  private coverOpen = true;
  private idle = 0;

  constructor() {
    const dismiss = () => this.openCover();
    window.addEventListener('keydown', dismiss);
    window.addEventListener('pointerdown', dismiss);
  }

  openCover() {
    if (!this.coverOpen) return;
    this.coverOpen = false;
    this.cover.classList.add('opened');
    setTimeout(() => { this.cover.style.display = 'none'; }, 1400);
  }

  setChapter(number: string, title: string) {
    this.chapterNumber.textContent = number;
    this.objective.textContent = title;
    const header = this.objective.parentElement!;
    header.classList.remove('arrive');
    void header.offsetWidth;
    header.classList.add('arrive');
  }

  setMayhemVisible(visible: boolean) {
    this.mayhem.classList.toggle('hidden', !visible);
    this.deeds.setVisible(visible);
  }

  /** New chapter: fresh deeds, fresh score, the end un-ended. */
  resetRun() {
    this.deeds.reset();
    this.ended = false;
    this.theEnd.classList.remove('visible');
    this.shownScore = 0;
    this.tierIndex = 0;
  }

  get hasEnded() {
    return this.ended;
  }

  showTheEnd(score: number) {
    if (this.ended) return;
    this.ended = true;
    const t = this.deeds.tally;
    $('#end-score').textContent = String(score);
    $('#end-tier').textContent = this.tier.textContent ?? '';
    $('#end-toasted').textContent = String(t.ignited);
    $('#end-flown').textContent = String(t.launched);
    $('#end-cottages').textContent = String(t.burnedCottages + t.flattenedCottages);
    $('#end-chain').textContent = `×${t.bestCombo}`;
    this.theEnd.classList.add('visible');
    // The last page lingers, then politely gets out of the way.
    setTimeout(() => this.theEnd.classList.remove('visible'), 9000);
  }

  setStats(text: string) {
    this.stats.textContent = text;
  }

  setLoading(visible: boolean, line = '') {
    if (line) this.loading.querySelector('.page-text')!.textContent = line;
    this.loading.classList.toggle('visible', visible);
  }

  narrate(key: keyof typeof LINES | string, force = false) {
    const lines = LINES[key];
    if (!lines) return;
    if (!force && this.narrationCooldown > 0) return;
    let line = pick(lines);
    if (line === this.lastLine && lines.length > 1) line = pick(lines.filter(l => l !== line));
    this.lastLine = line;
    this.typing = { text: line, shown: 0 };
    this.narrationCooldown = force ? 3 : 4.5;
    this.narrationTimer = 6 + line.length * .03;
    this.narrator.classList.add('visible');
  }

  /** Comic lettering at a world position: WHOOSH, BONK, CRUNCH. */
  pop(text: string, world: pc.Vec3, style: 'sfx' | 'shout' | 'points' | 'combo' | 'deed' = 'sfx', life = 1.1) {
    const el = document.createElement('div');
    el.className = `pop pop-${style}`;
    el.textContent = text;
    el.style.setProperty('--tilt', `${(Math.random() - .5) * 18}deg`);
    this.popups.appendChild(el);
    this.pops.push({ el, world: world.clone(), life, maxLife: life, rise: style === 'points' ? 1.6 : .8 });
    if (this.pops.length > 40) {
      const old = this.pops.shift()!;
      old.el.remove();
    }
  }

  handle(event: RampageEvent, at: pc.Vec3) {
    this.deeds.handle(event);
    switch (event.type) {
      case 'dwarfIgnited':
        this.pop(pick(SHOUTS), at.clone().add(new pc.Vec3(0, 1.7, 0)), 'shout', 1.4);
        this.points(event.points, at);
        this.narrate('dwarfIgnited');
        break;
      case 'dwarfLaunched':
        this.pop(pick(['BONK!', 'WHUMP!', 'BOING!', 'THWACK!', 'POW!']), at.clone().add(new pc.Vec3(0, 1.2, 0)), 'sfx');
        this.pop(pick(FLYING), at.clone().add(new pc.Vec3(0, 2.2, 0)), 'shout', 1.3);
        this.points(event.points, at);
        this.narrate(event.launches > 1 ? 'dwarfRelaunched' : 'dwarfLaunched');
        break;
      case 'propIgnited':
        this.points(event.points, at);
        if (event.kind === PropKind.Cottage) { this.pop('FWOOSH!', at.clone().add(new pc.Vec3(0, 4, 0)), 'sfx', 1.3); this.narrate('cottage'); }
        else if (event.kind === PropKind.Haystack) this.narrate('haystack');
        else if (event.kind === PropKind.Maypole) { this.pop('FWOOOM!', at.clone().add(new pc.Vec3(0, 7, 0)), 'sfx', 1.6); this.narrate('maypole', true); }
        else if (event.kind === PropKind.Stall) this.narrate('stall');
        else if (event.kind === PropKind.Tree && Math.random() < .15) this.narrate('tree');
        break;
      case 'propFlattened':
        this.pop(event.kind === PropKind.Cottage ? 'CRUNCH!' : pick(['SQUISH!', 'FLUMP!', 'CRINKLE!']), at.clone().add(new pc.Vec3(0, 2, 0)), 'sfx', 1.3);
        this.points(event.points, at);
        if (event.kind === PropKind.Cottage) this.narrate('flattened', true);
        break;
      case 'dwarfGone':
        if (Math.random() < .5) this.narrate('gone');
        break;
      default:
        break;
    }
    if ('combo' in event && event.combo >= 4 && event.combo % 4 === 0) {
      this.pop(`×${event.combo} MAYHEM!`, at.clone().add(new pc.Vec3(0, 3, 0)), 'combo', 1.5);
      if (event.combo >= 8) this.narrate('combo');
    }
  }

  private points(points: number, at: pc.Vec3) {
    if (points > 0) this.pop(`+${points}`, at.clone().add(new pc.Vec3(0, 2.6, 0)), 'points', 1.2);
  }

  update(dt: number, camera: pc.CameraComponent, score: number, combo: number, active: boolean) {
    // Popups follow their world anchor.
    const width = window.innerWidth;
    const height = window.innerHeight;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const pop = this.pops[i];
      pop.life -= dt;
      if (pop.life <= 0) {
        pop.el.remove();
        this.pops.splice(i, 1);
        continue;
      }
      const t = 1 - pop.life / pop.maxLife;
      pop.world.y += pop.rise * dt;
      camera.worldToScreen(pop.world, this.screen);
      const behind = this.screen.z < 0;
      pop.el.style.transform = `translate(${this.screen.x}px, ${this.screen.y}px) translate(-50%, -50%) rotate(var(--tilt)) scale(${Math.min(1, t * 8) * (1 + (1 - t) * .15)})`;
      pop.el.style.opacity = behind ? '0' : String(Math.min(1, pop.life * 3));
      void width; void height;
    }

    // The seal counts up rather than jumping.
    this.shownScore += (score - this.shownScore) * Math.min(1, dt * 6);
    if (Math.abs(score - this.shownScore) < .5) this.shownScore = score;
    this.score.textContent = String(Math.round(this.shownScore));
    let tierIndex = 0;
    for (let i = 0; i < TIERS.length; i++) if (score >= TIERS[i][0]) tierIndex = i;
    if (tierIndex !== this.tierIndex || !this.tier.textContent) {
      if (tierIndex > this.tierIndex) {
        this.mayhem.classList.remove('promote');
        void this.mayhem.offsetWidth;
        this.mayhem.classList.add('promote');
      }
      this.tierIndex = tierIndex;
      this.tier.textContent = TIERS[tierIndex][1];
    }
    this.combo.textContent = combo >= 2 ? `×${combo} chain` : '';
    this.deedsCount.textContent = `${this.deeds.total - this.deeds.remaining} of ${this.deeds.total}`;
    this.combo.classList.toggle('hot', combo >= 5);

    // Narrator typewriter.
    this.narrationCooldown -= dt;
    if (this.typing) {
      this.typing.shown = Math.min(this.typing.text.length, this.typing.shown + dt * 55);
      this.narrator.querySelector('span')!.textContent = this.typing.text.slice(0, Math.ceil(this.typing.shown));
      this.narrationTimer -= dt;
      if (this.narrationTimer <= 0) {
        this.narrator.classList.remove('visible');
        this.typing = null;
      }
    }

    // Controls card tucks itself away once the player is busy.
    this.idle = active ? 0 : this.idle + dt;
    this.controls.classList.toggle('tucked', !this.coverOpen && this.idle < 6 && performance.now() > 14000);
  }
}
