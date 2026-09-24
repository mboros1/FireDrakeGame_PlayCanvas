/**
 * Chapter codes: a whole chapter, compressed into text you can paste.
 *
 * There is no server to keep chapters on, so a bound chapter carries itself.
 * Its code is the level file, rounded, deflated and base64url'd behind a
 * version prefix: about 3.4 KB for all of Little Kindling. Binding is
 * therefore instant and offline, a code can never go missing, and a bound
 * chapter still never changes, because the code *is* the chapter.
 *
 * A chapter's id comes from its content, so the same chapter read twice is
 * the same book on the shelf, whoever sent it. Its nickname ("barley-896")
 * is only for people: short enough to say aloud and recognise, not to type.
 *
 * View-free, and safe in Node 18+ (CompressionStream and atob are global).
 */

import { toLevelFile, validateLevel, type LevelDefinition, type LevelFile } from '../sim/level';

/** Version prefix. A new encoding gets a new prefix; old codes keep decoding. */
const PREFIX = 'fd1.';
/** Refuse codes (and what they inflate to) beyond these, whatever they claim. */
export const MAX_CODE_CHARS = 64 * 1024;
const MAX_CHAPTER_BYTES = 128 * 1024;

export type DecodedChapter = { ok: true; level: LevelDefinition; code: string } | { ok: false; error: string };

/** A level with the precision nobody can see trimmed off, and no author id. */
const canonical = (level: LevelDefinition): LevelFile => {
  const r = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;
  const file = toLevelFile(level);
  return {
    ...file,
    id: 'chapter',
    props: file.props.map(p => ({ ...p, x: r(p.x, 2), z: r(p.z, 2), yaw: r(p.yaw, 1), size: r(p.size, 2) })),
    paths: file.paths.map(path => path.map(([x, z]) => [r(x, 2), r(z, 2)] as [number, number])),
    spawns: file.spawns.map(s => ({ x: r(s.x, 2), z: r(s.z, 2), yaw: r(s.yaw, 1) }))
  };
};

/** Bind a chapter: its code. */
export async function encodeChapter(level: LevelDefinition): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(canonical(level)));
  const packed = await pipe(json, new CompressionStream('deflate-raw'), Infinity);
  return PREFIX + toBase64Url(packed!);
}

/**
 * Read a code, or a link or pasted text containing one. Everything is
 * untrusted: the size is capped before and after inflating, and the level is
 * validated like any other.
 */
export async function decodeChapter(text: string): Promise<DecodedChapter> {
  const code = findCode(text);
  if (!code) return { ok: false, error: 'That is not a chapter code. Codes begin with "fd1." and are long; paste the whole thing.' };
  if (code.length > MAX_CODE_CHARS) return { ok: false, error: 'That code is far too long to be a chapter.' };
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(code.slice(PREFIX.length));
  } catch {
    return { ok: false, error: 'That code is smudged: some of it is missing or wrong. Copy it again.' };
  }
  const inflated = await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_CHAPTER_BYTES).catch(() => null);
  if (!inflated) return { ok: false, error: 'That code is smudged: some of it is missing or wrong. Copy it again.' };
  try {
    const level = validateLevel({ ...JSON.parse(new TextDecoder().decode(inflated)), id: chapterId(code) });
    return { ok: true, level, code };
  } catch {
    return { ok: false, error: 'That code holds something, but not a chapter this edition can read.' };
  }
}

/** A code found in a bare code, a `?chapter=` link, or a message around one. */
export const findCode = (text: string): string | null => {
  const match = /fd1\.[A-Za-z0-9_-]+/.exec(text.replace(/\s+/g, ''));
  return match ? match[0] : null;
};

/** The id every copy of this chapter shares: from its code, so from its content. */
export const chapterId = (code: string) => `chapter-${hash(code).toString(16).padStart(14, '0').slice(0, 12)}`;

const NICKNAMES = [
  'bakery', 'bonfire', 'cheese', 'cinder', 'cottage', 'ember', 'festival', 'goblet', 'hamlet', 'hayrick',
  'hearth', 'hoard', 'kindling', 'lantern', 'maypole', 'meadow', 'mill', 'orchard', 'pantry', 'parsnip',
  'pudding', 'quill', 'scorch', 'smoulder', 'stable', 'tinder', 'thatch', 'turnip', 'village', 'wyvern',
  'barley', 'bramble', 'chimney', 'dumpling', 'fiddle', 'gingham', 'haggis', 'marmalade', 'noodle', 'pickle'
];

/** "barley-896": a chapter's name for people, from its id. */
export const nickname = (id: string) => {
  const h = hash(id);
  return `${NICKNAMES[h % NICKNAMES.length]}-${100 + (Math.floor(h / NICKNAMES.length) % 900)}`;
};

/** A link that opens the chapter, where the page has a real address of its own. */
export const chapterLink = (code: string, base = window.location.href) => {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('chapter', code);
  return url.toString();
};

// ── Plumbing ────────────────────────────────────────────────────────────────

/** Run bytes through a (de)compression stream, giving up past `limit` bytes. */
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array | null> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes as Uint8Array<ArrayBuffer>).catch(() => {});
  void writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const toBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string) => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** cyrb53: a fast 53-bit string hash. Not cryptographic; ids only need to not collide by accident. */
const hash = (text: string) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};
