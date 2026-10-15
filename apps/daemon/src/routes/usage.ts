import type { Express } from 'express';
import path from 'node:path';
import type { RouteDeps } from '../server-context.js';
import { backfillUsageFromRuns } from '../usage/backfill.js';
import { isLoopbackPeerAddress } from '../http/local-daemon-request.js';
import { queryUsageRows, repriceUnpricedRecords } from '../usage/store.js';
import {
  buildUsageCsv,
  buildUsageSummary,
  parseUsageQuery,
  usageExportFilename,
} from '../usage/summary.js';

export interface RegisterUsageRoutesDeps extends RouteDeps<'db' | 'http' | 'paths'> {}

/**
 * Token usage statistics. Shared by the web page and `od usage …`.
 *   GET  /api/usage/summary   UsageQuery as query params -> UsageSummaryResponse
 *   GET  /api/usage/export    the same filters as CSV (UTF-8 BOM)
 *   POST /api/usage/backfill  rebuild records of past runs (`od usage backfill`)
 *   POST /api/usage/reprice   price records that had no price when written (`od usage reprice`)
 *
 * The two POSTs are maintenance for the operator: loopback only (the `od` CLI
 * runs on the daemon's host; a request that came through the sign-in proxy
 * carries forwarding headers and is refused), and one at a time (409).
 */
export function registerUsageRoutes(app: Express, ctx: RegisterUsageRoutesDeps): void {
  const { sendApiError } = ctx.http;
  const db = ctx.db as import('better-sqlite3').Database;

  app.get('/api/usage/summary', (req, res) => {
    const parsed = parseUsageQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return sendApiError(res, 400, 'BAD_REQUEST', parsed.message);
    res.json(buildUsageSummary(db, parsed.query));
  });

  app.get('/api/usage/export', (req, res) => {
    const parsed = parseUsageQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return sendApiError(res, 400, 'BAD_REQUEST', parsed.message);
    const q = parsed.query;
    const rows = queryUsageRows(db, {
      from: q.from,
      to: q.to,
      projectId: q.projectId,
      user: q.user,
      agentId: q.agentId,
      model: q.model,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${usageExportFilename(q)}"`);
    res.send(buildUsageCsv(rows));
  });

  let maintenanceRunning = false;
  const maintenance = (
    run: () => Promise<unknown>,
  ): import('express').RequestHandler => async (req, res) => {
    const proxied = req.get('x-forwarded-for') || req.get('x-forwarded-email') || req.get('x-forwarded-host');
    if (proxied || !isLoopbackPeerAddress(req.socket?.remoteAddress)) {
      return sendApiError(res, 403, 'FORBIDDEN', 'usage maintenance is only available from the daemon host');
    }
    if (maintenanceRunning) {
      return sendApiError(res, 409, 'CONFLICT', 'another usage maintenance task is already running');
    }
    maintenanceRunning = true;
    try {
      res.json(await run());
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
    } finally {
      maintenanceRunning = false;
    }
  };

  app.post(
    '/api/usage/backfill',
    maintenance(() => backfillUsageFromRuns(db, path.join(ctx.paths.RUNTIME_DATA_DIR, 'runs'))),
  );
  app.post('/api/usage/reprice', maintenance(() => repriceUnpricedRecords(db)));
}
