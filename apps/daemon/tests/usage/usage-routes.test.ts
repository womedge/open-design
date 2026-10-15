import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerUsageRoutes } from '../../src/routes/usage.js';
import { parseUsageArgs, runUsageCli } from '../../src/usage/usage-cli.js';
import { upsertUsageRecord } from '../../src/usage/store.js';
import { openTempDb, T, type TempDb } from './helpers.js';

let h: TempDb;
let server: import('node:http').Server;
let base = '';

beforeEach(async () => {
  h = openTempDb();
  upsertUsageRecord(h.db, {
    runId: 'r1', projectId: 'p1', user: 'a@x.com', agentId: 'claude', model: 'claude-sonnet-5-5',
    messageId: 'm1', ts: T('2026-10-14T16:30:00Z'),
    tokens: { input: 1_000_000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
  });
  const app = express();
  const sendApiError = (res: express.Response, status: number, code: string, message: string) =>
    res.status(status).json({ error: { code, message } });
  registerUsageRoutes(app, { db: h.db, http: { sendApiError }, paths: { RUNTIME_DATA_DIR: h.dir } } as never);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  h.cleanup();
});

describe('usage routes', () => {
  it('GET /api/usage/summary', async () => {
    const resp = await fetch(`${base}/api/usage/summary?from=2026-10-15&to=2026-10-15`);
    const body = (await resp.json()) as { totals: { costUsd: number }; recordedSince: string };
    expect(resp.status).toBe(200);
    expect(body.totals.costUsd).toBe(2);
    expect(body.recordedSince).toBe('2026-10-15');
  });

  it('rejects bad queries', async () => {
    const resp = await fetch(`${base}/api/usage/summary?from=nope&to=2026-10-15`);
    expect(resp.status).toBe(400);
  });

  it('GET /api/usage/export returns BOM-prefixed CSV with the contract filename', async () => {
    const resp = await fetch(`${base}/api/usage/export?from=2026-10-15&to=2026-10-15`);
    expect(resp.headers.get('content-disposition')).toContain('usage-2026-10-15-2026-10-15.csv');
    expect(resp.headers.get('content-type')).toContain('text/csv');
    const bytes = new Uint8Array(await resp.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('POST /api/usage/backfill and /reprice work from loopback', async () => {
    const resp = await fetch(`${base}/api/usage/backfill`, { method: 'POST' });
    expect(await resp.json()).toMatchObject({ runsScanned: 0, recordsWritten: 0 });
    const rp = await fetch(`${base}/api/usage/reprice`, { method: 'POST' });
    expect(await rp.json()).toMatchObject({ examined: 0, repriced: 0 });
  });

  it('maintenance refuses requests that came through a proxy', async () => {
    const resp = await fetch(`${base}/api/usage/backfill`, { method: 'POST', headers: { 'x-forwarded-for': '1.2.3.4' } });
    expect(resp.status).toBe(403);
  });

  it('a second maintenance request while one runs gets 409', async () => {
    // Make the runs directory large enough to keep the first call in flight.
    const runs = path.join(h.dir, 'runs');
    for (let i = 0; i < 150; i += 1) {
      const d = path.join(runs, `r${i}`);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify({ id: `r${i}`, agentId: 'claude' }));
      fs.writeFileSync(path.join(d, 'events.jsonl'), '');
    }
    const first = fetch(`${base}/api/usage/backfill`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 5));
    const second = await fetch(`${base}/api/usage/reprice`, { method: 'POST' });
    expect(second.status).toBe(409);
    expect((await first).status).toBe(200);
  });
});

describe('od usage export keeps the UTF-8 BOM', () => {
  it('--out writes the bytes unchanged', async () => {
    const out = path.join(h.dir, 'u.csv');
    const { exitCode } = await runUsageCli(['export', '--from', '2026-10-15', '--to', '2026-10-15', '--out', out, '--daemon-url', base]);
    expect(exitCode).toBe(0);
    expect([...fs.readFileSync(out).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('--out - writes the BOM to stdout', async () => {
    const chunks: Buffer[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((c: string | Uint8Array) => { chunks.push(Buffer.from(c)); return true; }) as never);
    try {
      await runUsageCli(['export', '--from', '2026-10-15', '--to', '2026-10-15', '--out', '-', '--daemon-url', base]);
    } finally { spy.mockRestore(); }
    expect([...Buffer.concat(chunks).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe('od usage argument parsing', () => {
  it('maps flags to query params', () => {
    const p = parseUsageArgs(['summary', '--from', '2026-10-01', '--to=2026-10-31', '--project', 'p1', '--agent', 'codex', '--json']);
    expect(p).toMatchObject({ command: 'summary', json: true, values: { from: '2026-10-01', to: '2026-10-31', projectId: 'p1', agentId: 'codex' } });
    expect(parseUsageArgs(['summary', '--bogus', 'x']).error).toMatch(/unknown flag/);
    expect(parseUsageArgs(['summary', '--from']).error).toMatch(/requires a value/);
  });
});
