/**
 * Bound chapters: players' levels, stored on the server and found by code.
 *
 * A chapter is bound once and never changes; binding again makes a new
 * code. That keeps the store simple and honest without accounts: nobody can
 * edit a chapter someone else is reading, because nobody can edit one at
 * all.
 *
 * Stored in SQLite (`node:sqlite`, built into Node 22) on the Fly volume at
 * `/data`. Behind {@link ChapterStore} so object storage can replace it
 * without touching the HTTP layer or the rooms.
 */

import { randomInt, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { toLevelFile, validateLevel, type LevelDefinition, type LevelFile } from '../src/sim/level';

export type BoundChapter = {
  code: string;
  level: LevelDefinition;
  title: string;
  heading: string | null;
  mood: string;
  createdAt: number;
  reads: number;
};

export interface ChapterStore {
  /** Store a validated level; returns its new code. */
  bind(level: LevelDefinition, ip: string): string;
  get(code: string): BoundChapter | null;
  /** Count one reading, for a future table of contents. */
  read(code: string): void;
  count(): number;
  /** Every chapter as one JSON object per line: the backup. */
  exportAll(): string;
}

/** Codes read aloud well and cannot be walked: a word and three digits. */
const WORDS = [
  'bakery', 'bonfire', 'cheese', 'cinder', 'cottage', 'ember', 'festival', 'goblet', 'hamlet', 'hayrick',
  'hearth', 'hoard', 'kindling', 'lantern', 'maypole', 'meadow', 'mill', 'orchard', 'pantry', 'parsnip',
  'pudding', 'quill', 'scorch', 'smoulder', 'stable', 'tinder', 'thatch', 'turnip', 'village', 'wyvern',
  'barley', 'bramble', 'chimney', 'dumpling', 'fiddle', 'gingham', 'haggis', 'marmalade', 'noodle', 'pickle'
];

export const CHAPTER_CODE = /^[a-z]{3,12}-\d{3,4}$/;

export class SqliteChapterStore implements ChapterStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists chapters (
        code text primary key,
        body text not null,
        title text not null,
        heading text,
        mood text not null,
        created_at integer not null,
        ip_hash text not null,
        reads integer not null default 0
      );
      create index if not exists chapters_created on chapters (created_at);
    `);
  }

  bind(level: LevelDefinition, ip: string): string {
    // A chapter's id is its code, so a room or a replay can name it.
    for (let attempt = 0; attempt < 20; attempt++) {
      const digits = attempt < 10 ? 3 : 4;
      const code = `${WORDS[randomInt(WORDS.length)]}-${randomInt(10 ** (digits - 1), 10 ** digits)}`;
      const file: LevelFile = toLevelFile({ ...level, id: `chapter-${code}` });
      try {
        this.db.prepare('insert into chapters (code, body, title, heading, mood, created_at, ip_hash) values (?, ?, ?, ?, ?, ?, ?)')
          .run(code, JSON.stringify(file), level.title, level.heading ?? null, level.mood ?? 'afternoon', Date.now(), hashIp(ip));
        return code;
      } catch (error) {
        if (!String(error).includes('UNIQUE')) throw error;
      }
    }
    throw new Error('no free chapter code');
  }

  get(code: string): BoundChapter | null {
    if (!CHAPTER_CODE.test(code)) return null;
    const row = this.db.prepare('select code, body, title, heading, mood, created_at, reads from chapters where code = ?').get(code) as
      { code: string; body: string; title: string; heading: string | null; mood: string; created_at: number; reads: number } | undefined;
    if (!row) return null;
    return {
      code: row.code,
      // Stored chapters were validated going in; validate coming out too, so
      // a chapter bound under older rules fails loudly rather than oddly.
      level: validateLevel(JSON.parse(row.body)),
      title: row.title,
      heading: row.heading,
      mood: row.mood,
      createdAt: row.created_at,
      reads: row.reads
    };
  }

  read(code: string) {
    this.db.prepare('update chapters set reads = reads + 1 where code = ?').run(code);
  }

  count() {
    return (this.db.prepare('select count(*) as n from chapters').get() as { n: number }).n;
  }

  exportAll() {
    const rows = this.db.prepare('select code, body, created_at, reads from chapters order by created_at').all() as
      { code: string; body: string; created_at: number; reads: number }[];
    return rows.map(r => JSON.stringify({ code: r.code, createdAt: r.created_at, reads: r.reads, level: JSON.parse(r.body) })).join('\n');
  }
}

/** IPs are kept only as a salted hash, for spotting abuse, never shown. */
const hashIp = (ip: string) => createHash('sha256').update(`fire-drake:${ip}`).digest('hex').slice(0, 16);
