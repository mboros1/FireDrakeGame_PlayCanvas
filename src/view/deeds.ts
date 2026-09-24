/**
 * Deeds: the storybook's to-do list. Goat-Simulator-style goals that give a
 * sandbox somewhere to go. Presentation-only bookkeeping over the event
 * stream — nothing here changes what the simulation does.
 */

import type { RampageEvent } from '../sim/rampage';
import { PropKind } from '../sim/props';
import type { DeedSpec, DeedTemplate } from '../sim/level';

type Tally = {
  ignited: number;
  launched: number;
  relaunched: number;
  flattenedCottages: number;
  burnedCottages: number;
  stalls: number;
  maypole: number;
  trees: number;
  haystacks: number;
  ghosts: number;
  bestCombo: number;
};

type Deed = { title: string; flavour: string; done: (t: Tally) => boolean; progress?: (t: Tally) => [number, number] };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('#', String(n)));

/**
 * What each deed template counts, and how it reads when the author does
 * not write their own words. `n` is the chapter's number for the deed.
 */
const TEMPLATES: Record<DeedTemplate, {
  count: (t: Tally) => number;
  title: (n: number) => string;
  flavour: (n: number) => string;
}> = {
  'ignite-dwarves': { count: t => t.ignited, title: n => plural(n, 'Warm a dwarf', 'Warm # dwarves'), flavour: () => 'Gently. Ish.' },
  'launch-dwarves': { count: t => t.launched, title: n => plural(n, 'Teach a dwarf to fly', 'Teach # dwarves to fly'), flavour: () => 'Charge into them.' },
  'relaunch-dwarf': { count: t => t.relaunched, title: n => plural(n, 'Frequent flyer', 'Frequent flyers, #'), flavour: () => 'Launch the same dwarf twice.' },
  'burn-cottages': { count: t => t.burnedCottages, title: n => plural(n, 'Warm a cottage', 'Warm # cottages'), flavour: () => 'Thatch burns so nicely.' },
  'flatten-cottages': { count: t => t.flattenedCottages, title: n => plural(n, 'Fold a cottage flat', 'Fold # cottages flat'), flavour: () => 'Charge. Do not stop.' },
  'undo-cottages': { count: t => t.burnedCottages + t.flattenedCottages, title: n => plural(n, 'Urban renewal', 'Urban renewal, # cottages'), flavour: () => 'Cottages, by any means.' },
  'burn-haystacks': { count: t => t.haystacks, title: n => plural(n, 'Make hay', 'Make hay, # times'), flavour: n => plural(n, 'One haystack.', '# haystacks.') },
  'burn-stalls': { count: t => t.stalls, title: n => plural(n, 'Toast the cheese', 'Toast # stalls'), flavour: () => 'The market stalls. For the cheese.' },
  'burn-trees': { count: t => t.trees, title: n => plural(n, 'Singe a tree', 'Clear-fell # trees'), flavour: n => plural(n, 'Just the one.', '# trees.') },
  'burn-maypole': { count: t => t.maypole, title: () => 'Light the maypole', flavour: () => 'It is, after all, a festival.' },
  'chain': { count: t => t.bestCombo, title: n => `A chain of ${n}`, flavour: () => 'Mayhem, uninterrupted.' },
  'ghosts': { count: t => t.ghosts, title: n => plural(n, 'A small haunting', 'A haunting of #'), flavour: n => plural(n, 'One little paper ghost.', '# little paper ghosts.') }
};

/** The usual deeds: Little Kindling's, and any chapter that names none. */
export const DEFAULT_DEEDS: DeedSpec[] = [
  { template: 'ignite-dwarves', count: 1 },
  { template: 'launch-dwarves', count: 1, title: 'Teach a dwarf to fly', flavour: 'Charge into one.' },
  { template: 'flatten-cottages', count: 1 },
  { template: 'burn-stalls', count: 1 },
  { template: 'relaunch-dwarf', count: 1 },
  { template: 'burn-maypole', count: 1 },
  { template: 'chain', count: 8, title: 'A chain of eight' },
  { template: 'burn-haystacks', count: 5, title: 'Hay, hay, hay', flavour: 'Five haystacks.' },
  { template: 'undo-cottages', count: 5, title: 'Urban renewal', flavour: 'Five cottages, by any means.' },
  { template: 'burn-trees', count: 30, title: 'Clear-fell the woods', flavour: 'Thirty trees.' },
  { template: 'ghosts', count: 10, title: 'A small haunting', flavour: 'Ten little paper ghosts.' }
];

/** How a template reads by default, for the desk's deed editor. */
export const deedWording = (spec: DeedSpec) => ({
  title: spec.title || TEMPLATES[spec.template].title(spec.count),
  flavour: spec.flavour || TEMPLATES[spec.template].flavour(spec.count)
});

const toDeed = (spec: DeedSpec): Deed => {
  const template = TEMPLATES[spec.template];
  const { title, flavour } = deedWording(spec);
  return {
    title,
    flavour,
    done: t => template.count(t) >= spec.count,
    progress: spec.count > 1 ? t => [Math.min(spec.count, template.count(t)), spec.count] : undefined
  };
};

const VISIBLE = 3;

export class Deeds {
  readonly tally: Tally = { ignited: 0, launched: 0, relaunched: 0, flattenedCottages: 0, burnedCottages: 0, stalls: 0, maypole: 0, trees: 0, haystacks: 0, ghosts: 0, bestCombo: 0 };
  private readonly completed = new Set<number>();
  private deeds: Deed[] = DEFAULT_DEEDS.map(toDeed);
  private readonly list: HTMLOListElement;
  private readonly shown: number[] = [];
  onComplete: (deed: string, remaining: number) => void = () => {};

  constructor(private readonly root: HTMLElement) {
    this.list = document.createElement('ol');
    root.appendChild(this.list);
    this.refill();
  }

  get remaining() {
    return this.deeds.length - this.completed.size;
  }

  get total() {
    return this.deeds.length;
  }

  /** Start over, with this chapter's deeds (or the usual ones). */
  reset(specs: DeedSpec[] = DEFAULT_DEEDS) {
    this.deeds = (specs.length > 0 ? specs : DEFAULT_DEEDS).map(toDeed);
    for (const key of Object.keys(this.tally) as (keyof Tally)[]) this.tally[key] = 0;
    this.completed.clear();
    this.shown.length = 0;
    this.list.replaceChildren();
    this.refill();
  }

  setVisible(visible: boolean) {
    this.root.classList.toggle('hidden', !visible);
  }

  handle(event: RampageEvent) {
    const t = this.tally;
    switch (event.type) {
      case 'dwarfIgnited': t.ignited++; break;
      case 'dwarfLaunched': t.launched++; if (event.launches > 1) t.relaunched++; break;
      case 'dwarfGone': t.ghosts++; break;
      case 'propFlattened': if (event.kind === PropKind.Cottage) t.flattenedCottages++; break;
      case 'propIgnited':
        if (event.kind === PropKind.Cottage) t.burnedCottages++;
        else if (event.kind === PropKind.Stall) t.stalls++;
        else if (event.kind === PropKind.Maypole) t.maypole++;
        else if (event.kind === PropKind.Tree) t.trees++;
        else if (event.kind === PropKind.Haystack) t.haystacks++;
        break;
      default: break;
    }
    if ('combo' in event) t.bestCombo = Math.max(t.bestCombo, event.combo);
    this.check();
  }

  private check() {
    for (const index of [...this.shown]) {
      const deed = this.deeds[index];
      const item = this.list.querySelector<HTMLLIElement>(`[data-deed="${index}"]`)!;
      const progress = deed.progress?.(this.tally);
      if (progress) item.querySelector('.deed-progress')!.textContent = `${progress[0]} / ${progress[1]}`;
      if (!this.completed.has(index) && deed.done(this.tally)) {
        this.completed.add(index);
        item.classList.add('done');
        this.onComplete(deed.title, this.remaining);
        setTimeout(() => {
          item.classList.add('leaving');
          setTimeout(() => {
            item.remove();
            this.shown.splice(this.shown.indexOf(index), 1);
            this.refill();
            this.check();
          }, 500);
        }, 1600);
      }
    }
  }

  private refill() {
    for (let i = 0; i < this.deeds.length && this.shown.length < VISIBLE; i++) {
      if (this.completed.has(i) || this.shown.includes(i)) continue;
      this.shown.push(i);
      const item = document.createElement('li');
      item.dataset.deed = String(i);
      item.innerHTML = `<span class="deed-box"></span><span class="deed-text"><span class="deed-title"></span><span class="deed-flavour"></span></span><span class="deed-progress"></span>`;
      item.querySelector('.deed-title')!.textContent = this.deeds[i].title;
      item.querySelector('.deed-flavour')!.textContent = this.deeds[i].flavour;
      const progress = this.deeds[i].progress?.(this.tally);
      if (progress) item.querySelector('.deed-progress')!.textContent = `${progress[0]} / ${progress[1]}`;
      this.list.appendChild(item);
    }
  }
}
