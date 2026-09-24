/**
 * The table of contents: the book's own chapters, then this reader's shelf
 * (chapters bound at the desk and chapters people have sent), newest first.
 *
 * There is no public shelf of everyone's chapters; that would need a server.
 * Chapters travel as codes, person to person, and land here when read.
 */

import { levelIds, getLevel } from '../sim/levels';
import { listShelf, removeFromShelf, shelfNickname, type ShelfEntry } from '../chapters/shelf';
import { chapterLink } from '../chapters/code';

export type ContentsHost = {
  /** Read a bound chapter alone, by its code. */
  read(code: string): void;
  /** Read a built-in chapter alone. */
  readBuiltIn(id: string): void;
  /** Open a room playing this chapter code (empty for the book's own). */
  together(code: string): void;
};

const MOOD_NAMES: Record<string, string> = { afternoon: 'an afternoon', moonlit: 'by moonlight', snow: 'in snow' };

export class Contents {
  private readonly root: HTMLDivElement;
  private confirming: string | null = null;

  constructor(private readonly host: ContentsHost) {
    this.root = document.createElement('div');
    this.root.id = 'contents';
    this.root.className = 'contents hidden';
    this.root.addEventListener('click', event => this.click(event));
    this.root.addEventListener('submit', event => {
      event.preventDefault();
      const input = this.root.querySelector<HTMLTextAreaElement>('#contents-code')!;
      this.host.read(input.value);
    });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.isOpen) this.close();
    });
    document.body.appendChild(this.root);
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }

  open() {
    this.confirming = null;
    this.render();
    this.root.classList.remove('hidden');
  }

  close() {
    this.root.classList.add('hidden');
  }

  /** Shown after a failed read from the paste box. */
  showError(text: string) {
    const error = this.root.querySelector<HTMLDivElement>('#contents-error');
    if (error) error.textContent = text;
  }

  private render() {
    const builtIn = levelIds().map(id => {
      const level = getLevel(id);
      return `<li class="contents-entry" data-builtin="${esc(id)}">
        <div class="entry-line"><span class="entry-title">${esc(level.title)}</span><span class="entry-dots"></span><span class="entry-nick">the book's own</span></div>
        <div class="entry-heading">${esc(level.heading || `In Which ${level.title} Has a Very Bad Day`)}</div>
        <div class="entry-actions"><button data-act="read-builtin">Read</button><button data-act="together">Read together</button></div>
      </li>`;
    }).join('');
    const shelf = listShelf();
    const entries = shelf.map(entry => this.entry(entry)).join('');
    this.root.innerHTML = `<div class="contents-page" role="dialog" aria-label="Table of contents">
      <button class="contents-close" data-act="close" aria-label="Close">×</button>
      <div class="contents-kicker">Fire Drake</div>
      <h2>Contents</h2>
      <div class="cover-rule"></div>
      <ol class="contents-list">${builtIn}${entries}</ol>
      ${shelf.length === 0 ? '<p class="contents-empty">Chapters you bind at the desk, and chapters people send you, are kept on this shelf.</p>' : ''}
      <form class="contents-add" autocomplete="off">
        <label for="contents-code">Someone sent you a chapter? Paste its code or link:</label>
        <div class="contents-add-row"><textarea id="contents-code" rows="2" spellcheck="false" placeholder="fd1.…"></textarea><button type="submit">Read</button></div>
        <div class="read-error" id="contents-error"></div>
      </form>
      <p class="contents-note">The shelf lives in this browser only. A code is the whole chapter, so keep the ones you care about somewhere safe.</p>
    </div>`;
  }

  private entry(entry: ShelfEntry) {
    const confirming = this.confirming === entry.id;
    return `<li class="contents-entry" data-id="${esc(entry.id)}">
      <div class="entry-line"><span class="entry-title">${esc(entry.title)}</span><span class="entry-dots"></span><span class="entry-nick">${esc(shelfNickname(entry))}</span></div>
      <div class="entry-heading">${esc(entry.heading || `In Which ${entry.title} Has a Very Bad Day`)}</div>
      <div class="entry-meta">${entry.origin === 'bound' ? 'bound by you' : 'sent to you'} · ${MOOD_NAMES[entry.mood] ?? entry.mood} · ${entry.props} cutouts</div>
      <div class="entry-actions">
        <button data-act="read">Read</button><button data-act="together">Read together</button><button data-act="copy">Copy the code</button>${framed() ? '' : '<button data-act="link">Copy a link</button>'}
        <button data-act="remove" class="${confirming ? 'confirm' : ''}">${confirming ? 'Really remove?' : 'Remove'}</button>
      </div>
    </li>`;
  }

  private click(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('[data-act]');
    if (!button) {
      // A click on the dimmed margin closes the book of contents.
      if (target === this.root) this.close();
      return;
    }
    const act = button.dataset.act;
    if (act === 'close') return this.close();
    const item = button.closest<HTMLLIElement>('.contents-entry');
    const builtin = item?.dataset.builtin;
    const entry = listShelf().find(e => e.id === item?.dataset.id);
    if (act === 'read-builtin' && builtin) return this.host.readBuiltIn(builtin);
    if (act === 'together') return this.host.together(entry?.code ?? '');
    if (!entry) return;
    if (act === 'read') return this.host.read(entry.code);
    if (act === 'copy' || act === 'link') {
      const text = act === 'copy' ? entry.code : chapterLink(entry.code);
      void navigator.clipboard?.writeText(text).then(() => {
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = act === 'copy' ? 'Copy the code' : 'Copy a link'; }, 1400);
      }).catch(() => {});
      return;
    }
    if (act === 'remove') {
      if (this.confirming === entry.id) {
        removeFromShelf(entry.id);
        this.confirming = null;
      } else {
        this.confirming = entry.id;
      }
      this.render();
    }
  }
}

/** In an itch.io frame the page's own address opens nothing useful; offer the code alone. */
export const framed = () => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
};

const esc = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
