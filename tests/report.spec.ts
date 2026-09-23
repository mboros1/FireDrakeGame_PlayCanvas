import { expect, test } from '@playwright/test';

/** The room server's report endpoint, which phones use to tell us what broke. */

const REPORT = 'http://127.0.0.1:8787/report';
const post = (body: string, ip: string) =>
  fetch(REPORT, { method: 'POST', body, headers: { 'content-type': 'text/plain', 'fly-client-ip': ip } });

test('accepts a report and rejects junk', async () => {
  const ip = `10.0.0.${Math.floor(Math.random() * 200)}`;
  expect((await post(JSON.stringify({ kind: 'error', message: 'boom', build: 'test' }), ip)).status).toBe(204);
  expect((await post('not json', ip)).status).toBe(400);
});

test('refuses oversized reports', async () => {
  const ip = `10.0.1.${Math.floor(Math.random() * 200)}`;
  const result = await post(JSON.stringify({ kind: 'error', message: 'x'.repeat(20_000) }), ip).catch(() => null);
  // Either a refusal or a dropped connection: never a 204.
  expect(result?.status ?? 0).not.toBe(204);
});

test('rate-limits a chatty client', async () => {
  const ip = `10.0.2.${Math.floor(Math.random() * 200)}`;
  const statuses: number[] = [];
  for (let i = 0; i < 35; i++) statuses.push((await post(JSON.stringify({ kind: 'error', message: `m${i}` }), ip)).status);
  expect(statuses.filter(s => s === 204).length).toBe(30);
  expect(statuses.at(-1)).toBe(429);
});
