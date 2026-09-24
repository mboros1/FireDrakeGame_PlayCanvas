/**
 * Binding and reading chapters on the room server. View-free.
 *
 * Chapters are immutable once bound: binding a draft again gives it a new
 * code. The server validates everything; so does this, on the way back in,
 * because a chapter is untrusted until it has been checked here too.
 */

import { toLevelFile, validateLevel, type LevelDefinition } from '../sim/level';

export type ChapterResult = { ok: true; code: string } | { ok: false; error: string; problems?: string[] };

/** HTTP(S) base of the room server, from its WebSocket address. */
export const serverHttpBase = (serverUrl: string) => {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
};

export const cleanChapterCode = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

export async function bindChapter(serverUrl: string, level: LevelDefinition): Promise<ChapterResult> {
  try {
    const response = await fetch(`${serverHttpBase(serverUrl)}/chapters`, {
      method: 'POST',
      // text/plain: no CORS preflight, which a sleeping server makes slow.
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(toLevelFile(level))
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && typeof body.code === 'string') return { ok: true, code: body.code };
    return { ok: false, error: body.error ?? `The binder answered ${response.status}.`, problems: body.problems };
  } catch {
    return { ok: false, error: 'The binder could not be reached. Is the storyteller asleep? Try again in a moment.' };
  }
}

export async function fetchChapter(serverUrl: string, code: string): Promise<{ ok: true; level: LevelDefinition } | { ok: false; error: string }> {
  const clean = cleanChapterCode(code);
  if (!/^[a-z]{3,12}-\d{3,4}$/.test(clean)) return { ok: false, error: 'Chapter codes look like "bakery-771".' };
  try {
    const response = await fetch(`${serverHttpBase(serverUrl)}/chapters/${clean}`);
    if (response.status === 404) return { ok: false, error: `No chapter is bound as "${clean}".` };
    if (!response.ok) return { ok: false, error: `The binder answered ${response.status}.` };
    const body = await response.json();
    return { ok: true, level: validateLevel(body.level) };
  } catch {
    return { ok: false, error: 'The binder could not be reached. Try again in a moment.' };
  }
}
