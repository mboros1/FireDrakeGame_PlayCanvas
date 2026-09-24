import { expect, test } from '@playwright/test';
import { chapterId, decodeChapter, encodeChapter, findCode, nickname } from '../src/chapters/code';
import { getLevel } from '../src/sim/levels';
import { toLevelFile, type LevelDefinition } from '../src/sim/level';

/** Chapter codes: the whole chapter in a string, with no server to keep it. */

const village = () => getLevel();

test('a chapter survives its code, rounded to what anyone can see', async () => {
  const level: LevelDefinition = { ...village(), title: 'The Bakery', heading: 'In Which the Bakery Learns Humility', mood: 'moonlit' };
  const code = await encodeChapter(level);
  expect(code.startsWith('fd1.')).toBe(true);
  // All of Little Kindling fits in a few kilobytes: a paste, not a download.
  expect(code.length).toBeLessThan(5000);

  const read = await decodeChapter(code);
  expect(read.ok).toBe(true);
  if (!read.ok) return;
  expect(read.level.title).toBe('The Bakery');
  expect(read.level.heading).toBe('In Which the Bakery Learns Humility');
  expect(read.level.mood).toBe('moonlit');
  expect(read.level.props.length).toBe(level.props.length);
  expect(read.level.id).toBe(chapterId(code));
  read.level.props.forEach((p, i) => {
    expect(p.kind).toBe(level.props[i].kind);
    expect(Math.abs(p.x - level.props[i].x)).toBeLessThanOrEqual(.005);
    expect(Math.abs(p.z - level.props[i].z)).toBeLessThanOrEqual(.005);
  });
});

test('the same chapter always binds to the same code and the same shelf entry', async () => {
  const a = await encodeChapter(village());
  const b = await encodeChapter({ ...village(), id: 'draft-someone-else' });
  expect(a).toBe(b);
  expect(chapterId(a)).toBe(chapterId(b));
  const changed = await encodeChapter({ ...village(), title: 'Little Kindling, Again' });
  expect(chapterId(changed)).not.toBe(chapterId(a));
  expect(nickname(chapterId(a))).toMatch(/^[a-z]+-\d{3}$/);
});

test('codes are found inside links and messages', async () => {
  const code = await encodeChapter(village());
  expect(findCode(`https://example.com/fire-drake/?chapter=${code}&x=1`)).toBe(code);
  expect(findCode(`try this one!\n${code.slice(0, 40)}\n${code.slice(40)}\n`)).toBe(code);
  expect((await decodeChapter(`https://example.com/?chapter=${code}`)).ok).toBe(true);
});

test('junk, damage and oversized codes are refused with a reason', async () => {
  const code = await encodeChapter(village());
  for (const bad of ['', 'bakery-771', 'fd1.', 'fd1.!!!!', code.slice(0, code.length - 60), `fd1.${'A'.repeat(70_000)}`]) {
    const read = await decodeChapter(bad);
    expect(read.ok, bad.slice(0, 20)).toBe(false);
    if (!read.ok) expect(read.error.length).toBeGreaterThan(10);
  }
  // A well-formed code holding something that is not a chapter.
  const packed = await new Response(new Blob(['{"hello":"world"}']).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  const notChapter = await decodeChapter(`fd1.${Buffer.from(packed).toString('base64url')}`);
  expect(notChapter.ok).toBe(false);
  if (!notChapter.ok) expect(notChapter.error).toContain('not a chapter');
});

test('a code that inflates past the size cap is refused, not unpacked', async () => {
  // 1 MB of one repeated prop compresses to almost nothing.
  const file = toLevelFile(village());
  const bomb = { ...file, title: 'x'.repeat(1_000_000) };
  const packed = await new Response(new Blob([JSON.stringify(bomb)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  const code = `fd1.${Buffer.from(packed).toString('base64url')}`;
  expect(code.length).toBeLessThan(10_000);
  expect((await decodeChapter(code)).ok).toBe(false);
});
