// Display formatting for the usage page. Pure, locale-independent on purpose:
// the numbers read the same on every machine (the page is for Taiwan users).

const nf = (maxFraction: number, minFraction = 0) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: minFraction,
    maximumFractionDigits: maxFraction,
  });

const USD_2 = nf(2, 2);
const WAN = nf(1);
const YI = nf(1, 1);
const INT = nf(0);

/** `US$50.86` — KPI cards and per-row amounts. */
export function formatUsd(value: number): string {
  return `US$${USD_2.format(value)}`;
}

/** `$50.86` — chart labels and the price table, where the unit is implied. */
export function formatUsdShort(value: number): string {
  return `$${USD_2.format(value)}`;
}

/** Prices keep up to 3 decimals (`$0.125`) but never trailing zeros past 2. */
export function formatPrice(value: number): string {
  const s = value.toFixed(3);
  return `$${s.endsWith('0') ? value.toFixed(2) : s}`;
}

export function formatInt(value: number): string {
  return INT.format(value);
}

/**
 * Token counts in 萬 / 億, unit inside the value:
 * `0` → "0", below 1 萬 the plain integer ("9,460"), `82_000_000` → "8,200 萬", `1_230_000_000` → "12.3 億".
 */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (Math.round(tokens) < 10_000) return INT.format(Math.round(tokens));
  const wan = Math.round(tokens / 1000) / 10; // 萬, one decimal
  if (wan >= 10_000) return `${YI.format(Math.round(tokens / 1e7) / 10)} 億`;
  return `${WAN.format(wan)} 萬`;
}

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface Delta {
  /** Whole-number percent, signed. */
  percent: number;
  direction: DeltaDirection;
  text: string;
}

/** Null when there is nothing to compare against (no base, or base is 0). */
export function computeDelta(current: number, base: number | null | undefined): Delta | null {
  if (base == null || !Number.isFinite(base) || base === 0) return null;
  const percent = Math.round(((current - base) / base) * 100);
  const direction: DeltaDirection = percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat';
  return { percent, direction, text: `${percent > 0 ? '+' : ''}${percent}%` };
}

/** `claude-opus-5-5` → "Claude Opus 5.5", `gpt-5.5` → "GPT-5.5". */
export function modelDisplayName(model: string): string {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(model);
  if (claude) {
    const family = claude[1]!;
    const version = claude[3] ? `${claude[2]}.${claude[3]}` : claude[2]!;
    return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${version}`;
  }
  const gpt = /^gpt-(.+)$/i.exec(model);
  if (gpt) return `GPT-${gpt[1]}`;
  return model;
}

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
};

export function agentDisplayName(agentId: string): string {
  return AGENT_LABELS[agentId] ?? agentId;
}

/** Share of `part` in `total` as "34.5%". */
export function formatShare(part: number, total: number): string {
  if (!(total > 0)) return '0.0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}
