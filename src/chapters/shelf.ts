/**
 * The shelf: every bound chapter this browser has written or read, kept in
 * localStorage. It is what the table of contents lists, since there is no
 * server to list everyone's.
 *
 * Entries keep the code, not the level: the code is the chapter, and
 * decoding it again on the way out means a shelf edited by hand is checked
 * like any other untrusted chapter.
 */

import type { LevelDefinition } from '../sim/level';
import { nickname } from './code';

export type ShelfEntry = {
  id: string;
  code: string;
  title: string;
  heading: string | null;
  mood: string;
  props: number;
  /** `bound` by this reader at the desk, or `read` from someone's code. */
  origin: 'bound' | 'read';
  addedAt: number;
  readAt: number | null;
};

const KEY = 'fire-drake:shelf';
/** Oldest-read entries fall off past this; a code can always be pasted again. */
const MAX_ENTRIES = 80;

export const listShelf = (): ShelfEntry[] => {
  try {
    const entries = JSON.parse(localStorage.getItem(KEY) ?? '[]') as ShelfEntry[];
    return Array.isArray(entries) ? entries.filter(e => e && typeof e.code === 'string' && typeof e.id === 'string') : [];
  } catch {
    return [];
  }
};

const write = (entries: ShelfEntry[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Private mode or a full store: the chapter still plays, it just is not kept.
  }
};

/**
 * Put a chapter on the shelf, or bring it to the front if it is there. A
 * chapter bound here stays marked as bound even when read again later.
 */
export const shelve = (level: LevelDefinition, code: string, origin: ShelfEntry['origin']): ShelfEntry => {
  const entries = listShelf();
  const existing = entries.find(e => e.id === level.id);
  const now = Date.now();
  const entry: ShelfEntry = {
    id: level.id,
    code,
    title: level.title,
    heading: level.heading ?? null,
    mood: level.mood ?? 'afternoon',
    props: level.props.length,
    origin: existing?.origin === 'bound' ? 'bound' : origin,
    addedAt: existing?.addedAt ?? now,
    readAt: origin === 'read' ? now : existing?.readAt ?? null
  };
  write([entry, ...entries.filter(e => e.id !== level.id)]);
  return entry;
};

export const removeFromShelf = (id: string) => write(listShelf().filter(e => e.id !== id));

export const shelfNickname = (entry: Pick<ShelfEntry, 'id'>) => nickname(entry.id);
