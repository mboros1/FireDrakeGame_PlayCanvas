/**
 * Deeds: the storybook's to-do list. Goat-Simulator-style goals that give a
 * sandbox somewhere to go. Presentation-only bookkeeping over the event
 * stream — nothing here changes what the simulation does.
 */

import type { RampageEvent } from '../sim/rampage';
import { PropKind } from '../sim/props';

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

const DEEDS: Deed[] = [
  { title: 'Warm a dwarf', flavour: 'Gently. Ish.', done: t => t.ignited >= 1 },
  { title: 'Teach a dwarf to fly', flavour: 'Charge into one.', done: t => t.launched >= 1 },
  { title: 'Fold a cottage flat', flavour: 'Charge. Do not stop.', done: t => t.flattenedCottages >= 1 },
  { title: 'Toast the cheese', flavour: 'The market stalls. For the cheese.', done: t => t.stalls >= 1 },
  { title: 'Frequent flyer', flavour: 'Launch the same dwarf twice.', done: t => t.relaunched >= 1 },
  { title: 'Light the maypole', flavour: 'It is, after all, a festival.', done: t => t.maypole >= 1 },
  { title: 'A chain of eight', flavour: 'Mayhem, uninterrupted.', done: t => t.bestCombo >= 8, progress: t => [Math.min(8, t.bestCombo), 8] },
  { title: 'Hay, hay, hay', flavour: 'Five haystacks.', done: t => t.haystacks >= 5, progress: t => [Math.min(5, t.haystacks), 5] },
  { title: 'Urban renewal', flavour: 'Five cottages, by any means.', done: t => t.burnedCottages + t.flattenedCottages >= 5, progress: t => [Math.min(5, t.burnedCottages + t.flattenedCottages), 5] },
  { title: 'Clear-fell the woods', flavour: 'Thirty trees.', done: t => t.trees >= 30, progress: t => [Math.min(30, t.trees), 30] },
  { title: 'A small haunting', flavour: 'Ten little paper ghosts.', done: t => t.ghosts >= 10, progress: t => [Math.min(10, t.ghosts), 10] }
];

const VISIBLE = 3;

export class Deeds {
  readonly tally: Tally = { ignited: 0, launched: 0, relaunched: 0, flattenedCottages: 0, burnedCottages: 0, stalls: 0, maypole: 0, trees: 0, haystacks: 0, ghosts: 0, bestCombo: 0 };
  private readonly completed = new Set<number>();
  private readonly list: HTMLOListElement;
  private readonly shown: number[] = [];
  onComplete: (deed: string, remaining: number) => void = () => {};

  constructor(private readonly root: HTMLElement) {
    this.list = document.createElement('ol');
    root.appendChild(this.list);
    this.refill();
  }

  get remaining() {
    return DEEDS.length - this.completed.size;
  }

  get total() {
    return DEEDS.length;
  }

  reset() {
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
      const deed = DEEDS[index];
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
    for (let i = 0; i < DEEDS.length && this.shown.length < VISIBLE; i++) {
      if (this.completed.has(i) || this.shown.includes(i)) continue;
      this.shown.push(i);
      const item = document.createElement('li');
      item.dataset.deed = String(i);
      item.innerHTML = `<span class="deed-box"></span><span class="deed-text"><span class="deed-title"></span><span class="deed-flavour"></span></span><span class="deed-progress"></span>`;
      item.querySelector('.deed-title')!.textContent = DEEDS[i].title;
      item.querySelector('.deed-flavour')!.textContent = DEEDS[i].flavour;
      const progress = DEEDS[i].progress?.(this.tally);
      if (progress) item.querySelector('.deed-progress')!.textContent = `${progress[0]} / ${progress[1]}`;
      this.list.appendChild(item);
    }
  }
}
