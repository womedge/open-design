import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClaudeMessageUsageCollector } from '../../src/usage/claude-message-usage.js';
import { createRunUsageRecorder } from '../../src/usage/recorder.js';
import { buildUsageSummary } from '../../src/usage/summary.js';
import { openTempDb, type TempDb } from './helpers.js';

/**
 * Cross-check against ccusage v20.0.32 on a fixture transcript
 * (tests/fixtures/usage/claude-config). The fixture exercises: duplicate frames
 * (max wins), 5m/1h split, missing cache_creation (all 5m), Haiku 5.5 100k
 * tier, fast speed, a sidechain message and the Asia/Taipei day boundary.
 *
 * `ccusage-expected.json` is the recorded output of
 *   CLAUDE_CONFIG_DIR=<fixture> npx ccusage@20.0.32 claude daily --instances --breakdown --json --offline -z Asia/Taipei
 * Set USAGE_CCUSAGE_LIVE=1 to re-run ccusage itself instead of the snapshot.
 *
 * Intentional difference: ccusage lists fast-speed messages under a separate
 * model name (`claude-opus-5-5-fast`); we keep one model and a `speed` flag, so
 * the comparison is per day, not per model name.
 */
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/usage');
let h: TempDb;
beforeEach(() => { h = openTempDb(); });
afterEach(() => h.cleanup());

function ccusageDaily(): Record<string, number> {
  const raw =
    process.env.USAGE_CCUSAGE_LIVE === '1'
      ? execFileSync('npx', ['--yes', 'ccusage@20.0.32', 'claude', 'daily', '--instances', '--breakdown', '--json', '--offline', '-z', 'Asia/Taipei'], {
          env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(FIX, 'claude-config') },
          encoding: 'utf8',
        })
      : fs.readFileSync(path.join(FIX, 'ccusage-expected.json'), 'utf8');
  const parsed = JSON.parse(raw) as { projects: Record<string, Array<{ date: string; totalCost: number }>> };
  const byDay: Record<string, number> = {};
  for (const rows of Object.values(parsed.projects)) for (const r of rows) byDay[r.date] = (byDay[r.date] ?? 0) + r.totalCost;
  return byDay;
}

describe('ccusage cross-check', () => {
  it('per-day cost equals ccusage on the same transcript', () => {
    const recorder = createRunUsageRecorder({ db: h.db, run: { id: 'run-x', projectId: 'p1' }, agentId: 'claude', getModel: () => null });
    const collector = createClaudeMessageUsageCollector((m) => recorder.recordClaude(m));
    const file = fs.readdirSync(path.join(FIX, 'claude-config/projects'))[0]!;
    const dir = path.join(FIX, 'claude-config/projects', file);
    for (const f of fs.readdirSync(dir)) {
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)) {
        const rec = JSON.parse(line);
        // A transcript record is the same shape as a stream-json assistant frame.
        collector.observe({
          type: 'assistant',
          message: rec.message,
          request_id: rec.requestId,
          timestamp: rec.timestamp,
          parent_tool_use_id: rec.isSidechain ? 'toolu_x' : null,
        });
      }
    }
    collector.flush();

    const ours = buildUsageSummary(h.db, { from: '2026-10-01', to: '2026-10-31' });
    const theirs = ccusageDaily();
    for (const d of ours.daily) {
      expect(d.costUsd, `day ${d.date}`).toBeCloseTo(theirs[d.date] ?? 0, 6);
    }
    expect(Object.keys(theirs).sort()).toEqual(['2026-10-14', '2026-10-15']);
  });
});
