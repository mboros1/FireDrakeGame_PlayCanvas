/**
 * Chapter drafts kept in this browser. The desk autosaves here after every
 * edit; export and import move a draft between browsers as a
 * `.chapter.json` file. Binding turns a draft into a chapter code
 * (`src/chapters/code.ts`), which carries the same shape.
 *
 * Storage can be missing (private windows) or full; every access is guarded
 * and failure is reported, never thrown into the game.
 */

import { toLevelFile, validateLevel, type LevelDefinition, type LevelFile, LEVEL_FORMAT } from '../sim/level';
import { getLevel } from '../sim/levels';

const KEY = 'fire-drake:chapter-drafts';
/** Oldest drafts are dropped past this, so storage cannot grow without bound. */
const MAX_DRAFTS = 24;

export type Draft = { id: string; title: string; updatedAt: number; level: LevelFile };

type Store = { current: string | null; drafts: Draft[] };

const read = (): Store => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { current: null, drafts: [] };
    const parsed = JSON.parse(raw) as Store;
    return { current: parsed.current ?? null, drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [] };
  } catch {
    return { current: null, drafts: [] };
  }
};

const write = (store: Store): boolean => {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
};

export const newDraftId = () => `draft-${Math.random().toString(36).slice(2, 8)}`;

/** A blank page: a pond, a road in, one bookmark, nothing to burn yet. */
export const blankChapter = (): LevelDefinition => validateLevel({
  format: LEVEL_FORMAT,
  id: newDraftId(),
  title: 'An Untitled Chapter',
  props: [],
  paths: [[[0, 52], [0, 30]]],
  pond: null,
  spawns: [{ x: 0, z: 38, yaw: 0 }]
});

/** A copy of a built-in chapter to start from. */
export const copyOfChapter = (id: string): LevelDefinition => {
  const source = getLevel(id);
  return validateLevel({ ...toLevelFile(source), id: newDraftId(), title: `${source.title}, Revised` });
};

export const listDrafts = () => read().drafts.slice().sort((a, b) => b.updatedAt - a.updatedAt);

export const currentDraftId = () => read().current;

/** The draft to open at the desk: the current one, else the newest, else none. */
export const loadDraft = (id?: string): LevelDefinition | null => {
  const store = read();
  const draft = store.drafts.find(d => d.id === (id ?? store.current)) ?? listDrafts()[0];
  if (!draft) return null;
  try {
    return validateLevel(draft.level);
  } catch {
    return null;
  }
};

/** Save (or replace) a draft and make it current. Returns false if storage refused. */
export const saveDraft = (level: LevelDefinition): boolean => {
  const store = read();
  const entry: Draft = { id: level.id, title: level.title, updatedAt: Date.now(), level: toLevelFile(level) };
  store.drafts = [entry, ...store.drafts.filter(d => d.id !== level.id)].slice(0, MAX_DRAFTS);
  store.current = level.id;
  return write(store);
};

/** Versioned: the first key held server codes, which no longer open anything. */
const BINDINGS_KEY = 'fire-drake:chapter-bindings-2';

/** Nicknames a draft has been bound as, newest first. Each bind of a changed draft is a new chapter. */
export const bindingsFor = (draftId: string): { code: string; at: number }[] => {
  try {
    const all = JSON.parse(localStorage.getItem(BINDINGS_KEY) ?? '{}') as Record<string, { code: string; at: number }[]>;
    return all[draftId] ?? [];
  } catch {
    return [];
  }
};

export const recordBinding = (draftId: string, code: string) => {
  try {
    const all = JSON.parse(localStorage.getItem(BINDINGS_KEY) ?? '{}') as Record<string, { code: string; at: number }[]>;
    all[draftId] = [{ code, at: Date.now() }, ...(all[draftId] ?? [])].slice(0, 12);
    localStorage.setItem(BINDINGS_KEY, JSON.stringify(all));
  } catch {
    // The code is still shown; it just is not remembered here.
  }
};

export const deleteDraft = (id: string) => {
  const store = read();
  store.drafts = store.drafts.filter(d => d.id !== id);
  if (store.current === id) store.current = store.drafts[0]?.id ?? null;
  write(store);
};

/** Serialise for export, one prop per line so the file diffs and reads well. */
export const chapterJson = (level: LevelDefinition) =>
  JSON.stringify(toLevelFile(level), null, 2)
    .replace(/\{\n\s+"kind": ("[a-z]+"),\n\s+"x": ([-\d.e]+),\n\s+"z": ([-\d.e]+),\n\s+"yaw": ([-\d.e]+),\n\s+"size": ([-\d.e]+),\n\s+"variant": (\d+)\n\s+\}/g,
      (_m, k, x, z, y, s, v) => `{ "kind": ${k}, "x": ${x}, "z": ${z}, "yaw": ${y}, "size": ${s}, "variant": ${v} }`)
    .replace(/\[\n\s+([-\d.e]+),\n\s+([-\d.e]+)\n\s+\]/g, '[$1, $2]');

/** Parse an imported file. Throws the validator's LevelError on bad content. */
export const parseChapter = (text: string): LevelDefinition => {
  const parsed = JSON.parse(text) as LevelFile;
  const level = validateLevel(parsed);
  // An imported chapter becomes a new draft unless it is already ours.
  const known = read().drafts.some(d => d.id === level.id);
  return known ? level : { ...level, id: level.id.startsWith('draft-') ? level.id : newDraftId() };
};
