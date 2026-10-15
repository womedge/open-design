import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { USAGE_AUTOMATIC_USER, type UsageTokens } from '@open-design/contracts';
import { isLoopbackPeerAddress } from '../http/local-daemon-request.js';
import type { ClaudeMessageUsage } from './claude-message-usage.js';
import {
  getCodexCursor,
  setCodexCursor,
  upsertUsageRecord,
  type CodexCursor,
} from './store.js';

type SqliteDb = Database.Database;

/**
 * Who started a run, for usage attribution. The daemon sits behind a
 * single-sign-on proxy in team deployments, and `X-Forwarded-Email` is only
 * believable when the request really arrived from that proxy: a loopback peer
 * (a local browser, the `od` CLI, an agent child process) can type any header,
 * so it is ignored and the run counts as automatic.
 */
export function resolveUsageUser(req: {
  get(name: string): string | undefined;
  socket?: { remoteAddress?: string | undefined } | undefined;
}): string {
  const peer = req.socket?.remoteAddress;
  if (typeof peer !== 'string' || isLoopbackPeerAddress(peer)) return USAGE_AUTOMATIC_USER;
  const raw = String(req.get('x-forwarded-email') ?? '').trim().toLowerCase();
  if (!raw || raw.length > 320 || /[\s,;<>"]/.test(raw) || !raw.includes('@')) return USAGE_AUTOMATIC_USER;
  return raw;
}

export interface UsageRunLike {
  id: string;
  projectId?: string | null;
  usageUser?: string | null;
}

export interface RunUsageRecorderOptions {
  db: SqliteDb;
  run: UsageRunLike;
  agentId: string;
  /** Model the daemon asked the agent to use (null/`default` when unknown). */
  getModel: () => string | null | undefined;
  /** `fast` when the run uses the vendor's priority/fast tier. */
  getSpeed?: () => string | null;
  /** Codex thread id once the stream reported it. */
  getThreadId?: () => string | null | undefined;
  isResuming?: () => boolean;
  now?: () => number;
}

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * Turns agent usage into stored per-message records. Every method swallows its
 * own errors: statistics must never fail a run.
 */
export function createRunUsageRecorder(opts: RunUsageRecorderOptions) {
  const now = opts.now ?? (() => Date.now());
  const attemptTag = randomUUID().slice(0, 8);
  let opencodeStep = 0;
  let codexPrev: CodexCursor | null = null;
  let codexThread: string | null = null;

  const user = () => opts.run.usageUser || USAGE_AUTOMATIC_USER;
  const modelId = () => {
    // The model the agent said it is really using beats the one we asked for.
    const m = observedModel ?? opts.getModel();
    return m && m !== 'default' ? m : 'unknown';
  };

  let observedModel: string | null = null;

  function write(messageId: string, model: string, tokens: UsageTokens, ts: number, speed?: string | null, reportedCostUsd?: number | null) {
    upsertUsageRecord(opts.db, {
      runId: opts.run.id,
      projectId: opts.run.projectId ?? null,
      user: user(),
      agentId: opts.agentId,
      model,
      messageId,
      ts,
      tokens,
      speed: speed ?? null,
      reportedCostUsd: reportedCostUsd ?? null,
    });
  }

  function recordClaude(msg: ClaudeMessageUsage): void {
    try {
      write(msg.messageId, msg.model, msg.tokens, msg.ts, msg.speed);
    } catch (err) {
      console.warn('[usage] failed to record claude message', err);
    }
  }

  /** Codex usage is thread-cumulative: store the delta since the last value. */
  function observeCodex(usage: Record<string, unknown>): void {
    const cum: CodexCursor = {
      input: n(usage.input_tokens),
      cached: n(usage.cached_read_tokens),
      output: n(usage.output_tokens),
    };
    if (cum.input === 0 && cum.output === 0) return;
    const realThread = opts.getThreadId?.() || null;
    const thread = realThread ?? `run:${opts.run.id}`;
    if (codexThread !== thread) {
      codexThread = thread;
      codexPrev = getCodexCursor(opts.db, thread);
      if (!codexPrev && realThread && opts.isResuming?.()) {
        // A resumed thread we never measured: its first counter already holds
        // all earlier runs, so use it as the baseline instead of billing it.
        setCodexCursor(opts.db, thread, cum, now());
        codexPrev = cum;
        return;
      }
    }
    const prev = codexPrev ?? { input: 0, cached: 0, output: 0 };
    // A smaller counter means the thread restarted/compacted: take it whole.
    const reset = cum.input < prev.input || cum.output < prev.output;
    const delta = reset
      ? cum
      : {
          input: cum.input - prev.input,
          cached: Math.max(0, cum.cached - prev.cached),
          output: cum.output - prev.output,
        };
    codexPrev = cum;
    setCodexCursor(opts.db, thread, cum, now());
    if (delta.input <= 0 && delta.output <= 0) return;
    const cached = Math.min(delta.cached, delta.input);
    // cached ⊂ input; reasoning ⊂ output (already inside output_tokens).
    write(
      `${thread}:${cum.input}:${cum.output}`,
      modelId(),
      { input: delta.input - cached, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: cached, output: delta.output },
      now(),
      opts.getSpeed?.() ?? null,
    );
  }

  /** OpenCode emits one usage event per step; reasoning is billed as output. */
  function observeOpenCode(usage: Record<string, unknown>, costUsd?: unknown): void {
    const tokens: UsageTokens = {
      input: n(usage.input_tokens),
      cacheWrite5m: n(usage.cached_write_tokens),
      cacheWrite1h: 0,
      cacheRead: n(usage.cached_read_tokens),
      output: n(usage.output_tokens) + n(usage.thought_tokens),
    };
    opencodeStep += 1;
    write(`${attemptTag}:step:${opencodeStep}`, modelId(), tokens, now(), null, typeof costUsd === 'number' ? costUsd : null);
  }

  /** Feed every `agent` `usage` event; only codex and opencode are metered here. */
  function observeAgentUsage(data: unknown): void {
    try {
      if (!data || typeof data !== 'object') return;
      const usage = (data as { usage?: unknown }).usage;
      if (!usage || typeof usage !== 'object') return;
      if (opts.agentId === 'codex') observeCodex(usage as Record<string, unknown>);
      else if (opts.agentId === 'opencode' || opts.agentId === 'byok-opencode') {
        observeOpenCode(usage as Record<string, unknown>, (data as { costUsd?: unknown }).costUsd);
      }
    } catch (err) {
      console.warn('[usage] failed to record agent usage', err);
    }
  }

  /** Model reported by the agent itself (Codex app-server `thread/start` result). */
  function setObservedModel(model: string | null | undefined): void {
    if (typeof model === 'string' && model.trim()) observedModel = model.trim();
  }

  return { recordClaude, observeAgentUsage, setObservedModel };
}
