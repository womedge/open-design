import { writeFile } from 'node:fs/promises';
import type { UsageSummaryResponse } from '@open-design/contracts';
import { resolveDaemonUrl } from '../daemon-url.js';

/**
 * `od usage summary|export|backfill` — thin client over /api/usage/*, the same
 * endpoints the web page uses.
 */

const USAGE = `Usage:
  od usage summary --from YYYY-MM-DD --to YYYY-MM-DD [--compare-from D --compare-to D]
                   [--project <id>] [--user <email|automatic>] [--agent <id>] [--model <id>] [--json]
  od usage export  --from YYYY-MM-DD --to YYYY-MM-DD [--project ...] [--user ...] [--agent ...]
                   [--model ...] [--out <path>]
  od usage backfill [--json]
  od usage reprice  [--json]

Dates are calendar days in Asia/Taipei, inclusive. 'export' writes the CSV that
the web page downloads (default file name usage-<from>-<to>.csv, or '-' for stdout).
'backfill' rebuilds usage records of past runs once and fills in project names (also those of
deleted projects, where recoverable); running it again is a no-op.
'reprice' prices records that had no price when they were written (a model added to the
price table later), at the price effective on each record's day; running it again is a no-op.
backfill/reprice only work from the daemon's own host.
Common: --daemon-url <url>
`;

const VALUE_FLAGS: Record<string, string> = {
  from: 'from',
  to: 'to',
  'compare-from': 'compareFrom',
  'compare-to': 'compareTo',
  project: 'projectId',
  user: 'user',
  agent: 'agentId',
  model: 'model',
  out: 'out',
  'daemon-url': 'daemonUrl',
};

interface Parsed {
  command: string | undefined;
  values: Record<string, string>;
  json: boolean;
  help: boolean;
  error?: string;
}

export function parseUsageArgs(args: string[]): Parsed {
  const out: Parsed = { command: undefined, values: {}, json: false, help: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a === '--json') { out.json = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
      const mapped = VALUE_FLAGS[key];
      if (!mapped) return { ...out, error: `unknown flag: --${key}` };
      const value = eq >= 0 ? a.slice(eq + 1) : args[++i];
      if (value === undefined) return { ...out, error: `flag --${key} requires a value` };
      out.values[mapped] = value;
      continue;
    }
    if (!out.command) out.command = a;
  }
  return out;
}

function queryString(values: Record<string, string>): string {
  const p = new URLSearchParams();
  for (const k of ['from', 'to', 'compareFrom', 'compareTo', 'projectId', 'user', 'agentId', 'model']) {
    if (values[k]) p.set(k, values[k]!);
  }
  return p.toString();
}

function fail(message: string, json: boolean): { exitCode: number } {
  if (json) process.stderr.write(`${JSON.stringify({ error: { message } })}\n`);
  else process.stderr.write(`${message}\n`);
  return { exitCode: 1 };
}

const fmt = (n: number) => `$${n.toFixed(4)}`;

function printSummary(s: UsageSummaryResponse): void {
  console.log(`Usage ${s.query.from} .. ${s.query.to}`);
  console.log(`  cost ${fmt(s.totals.costUsd)}   tokens ${s.totals.tokens.toLocaleString('en-US')}   runs ${s.totals.runs}`);
  if (s.compareTotals) {
    const c = s.compareTotals;
    const delta = c.costUsd > 0 ? ` (${(((s.totals.costUsd - c.costUsd) / c.costUsd) * 100).toFixed(1)}%)` : '';
    console.log(`  compare ${s.query.compareFrom} .. ${s.query.compareTo}: ${fmt(c.costUsd)}${delta}`);
  }
  const section = (title: string, lines: string[]) => {
    if (lines.length === 0) return;
    console.log(`\n${title}`);
    for (const l of lines) console.log(`  ${l}`);
  };
  section('Projects', s.projects.map((p) => `${fmt(p.costUsd)}  ${p.runs} runs  ${p.projectName ?? '(deleted)'} [${p.projectId}]`));
  section('People', s.people.map((p) => `${fmt(p.costUsd)}  ${p.runs} runs  ${p.user}`));
  section('Models', s.models.map((m) => `${fmt(m.costUsd)}  ${m.runs} runs  ${m.model}`));
  if (s.unpricedModels.length) console.log(`\nUnpriced models (counted as $0): ${s.unpricedModels.join(', ')}`);
}

export async function runUsageCli(args: string[]): Promise<{ exitCode: number }> {
  const parsed = parseUsageArgs(args);
  if (parsed.error) return fail(`${parsed.error}\n\n${USAGE}`, parsed.json);
  if (parsed.help || !parsed.command) {
    process.stdout.write(USAGE);
    return { exitCode: parsed.command || parsed.help ? 0 : 2 };
  }
  const base = (await resolveDaemonUrl({ flagUrl: parsed.values.daemonUrl ?? null })).replace(/\/$/, '');
  const request = async (method: string, route: string): Promise<Response | { exitCode: number }> => {
    try {
      return await fetch(`${base}${route}`, { method });
    } catch (err) {
      return fail(`Cannot reach daemon at ${base}: ${err instanceof Error ? err.message : String(err)}`, parsed.json);
    }
  };
  const failed = async (resp: Response) => fail(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`, parsed.json);

  if (parsed.command === 'summary' || parsed.command === 'export') {
    if (!parsed.values.from || !parsed.values.to) return fail('--from and --to are required (YYYY-MM-DD)', parsed.json);
    const route = `/api/usage/${parsed.command}?${queryString(parsed.values)}`;
    const resp = await request('GET', route);
    if (!('ok' in resp)) return resp;
    if (!resp.ok) return failed(resp);
    if (parsed.command === 'summary') {
      const data = (await resp.json()) as UsageSummaryResponse;
      if (parsed.json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
      else printSummary(data);
      return { exitCode: 0 };
    }
    // Bytes, not text(): text() drops the UTF-8 BOM Excel needs for Chinese names.
    const csv = Buffer.from(await resp.arrayBuffer());
    const target = parsed.values.out ?? `usage-${parsed.values.from}-${parsed.values.to}.csv`;
    if (target === '-') {
      process.stdout.write(csv);
    } else {
      await writeFile(target, csv, 'utf8');
      if (parsed.json) process.stdout.write(`${JSON.stringify({ ok: true, path: target })}\n`);
      else console.log(`wrote ${target}`);
    }
    return { exitCode: 0 };
  }

  if (parsed.command === 'backfill') {
    const resp = await request('POST', '/api/usage/backfill');
    if (!('ok' in resp)) return resp;
    if (!resp.ok) return failed(resp);
    const data = (await resp.json()) as Record<string, number>;
    if (parsed.json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    else {
      console.log(
        `backfill: scanned ${data.runsScanned}, backfilled ${data.runsBackfilled} runs (${data.recordsWritten} records), ` +
          `already had records ${data.runsSkippedExisting}, other agents ${data.runsSkippedOtherAgent}, no usage ${data.runsWithoutUsage}; ` +
          `project names filled ${data.projectNamesFilled}, deleted projects still unnamed ${data.deletedProjectsUnnamed}`,
      );
    }
    return { exitCode: 0 };
  }
  if (parsed.command === 'reprice') {
    const resp = await request('POST', '/api/usage/reprice');
    if (!('ok' in resp)) return resp;
    if (!resp.ok) return failed(resp);
    const data = (await resp.json()) as Record<string, number>;
    if (parsed.json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    else console.log(`reprice: examined ${data.examined}, repriced ${data.repriced}, still unpriced ${data.stillUnpriced}`);
    return { exitCode: 0 };
  }
  return fail(`unknown subcommand: od usage ${parsed.command}\n\n${USAGE}`, parsed.json);
}
