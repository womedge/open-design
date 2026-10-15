import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { USAGE_AUTOMATIC_USER } from '@open-design/contracts';
import type { UsageQuery, UsageSummaryResponse } from '@open-design/contracts';
import { Button, Select } from '@open-design/components';

import { useT } from '../../i18n';
import { Icon } from '../Icon';
import { Collapsible } from './Collapsible';
import { UsageChart } from './UsageChart';
import { UsageDateRangePicker } from './UsageDateRangePicker';
import { UsageDetail } from './UsageDetail';
import { UsagePeople } from './UsagePeople';
import { downloadUsageExport, fetchUsageSummary } from './usage-api';
import {
  compareRangeFor,
  defaultRangeState,
  rederiveRange,
  toIso,
  todayInTaipei,
  type UsageRangeState,
} from './usage-dates';
import {
  agentDisplayName,
  computeDelta,
  formatInt,
  formatShare,
  formatTokens,
  formatUsd,
  modelDisplayName,
  type Delta,
} from './usage-format';
import { USAGE_NO_PROJECT_ID, buildModelColors } from './usage-model';
import { ProjectName } from './ProjectName';
import { buildProjectLabels, plainProjectLabel, type UsageProjectLabel } from './usage-project-labels';
import { listProjects } from '../../state/projects';
import styles from './UsageView.module.css';

interface Filters {
  projectId: string;
  user: string;
  agentId: string;
  model: string;
}

const NO_FILTERS: Filters = { projectId: '', user: '', agentId: '', model: '' };
const BASE_AGENTS = ['claude', 'codex', 'opencode'];

interface Options {
  projects: Map<string, { name: string | null; deleted: boolean }>;
  users: Set<string>;
  agents: Set<string>;
  models: Set<string>;
}

function emptyOptions(): Options {
  return { projects: new Map(), users: new Set(), agents: new Set(BASE_AGENTS), models: new Set() };
}

/** Filter choices only ever grow while the page is open, so narrowing by one filter never hides the others. */
function mergeOptions(prev: Options, summary: UsageSummaryResponse): Options {
  const next: Options = {
    projects: new Map(prev.projects),
    users: new Set(prev.users),
    agents: new Set(prev.agents),
    models: new Set(prev.models),
  };
  for (const p of summary.projects) {
    next.projects.set(p.projectId, { name: p.projectName, deleted: p.deleted === true });
  }
  // Deleted projects that only appear in a person's drill-down still need a name.
  for (const person of summary.people) {
    for (const x of person.projects) {
      if (!next.projects.has(x.key)) next.projects.set(x.key, { name: x.name ?? null, deleted: x.deleted === true });
    }
  }
  for (const p of summary.people) next.users.add(p.user);
  for (const m of summary.models) {
    next.models.add(m.model);
    for (const a of m.agentIds) next.agents.add(a);
  }
  return next;
}

export function UsageView() {
  const t = useT();
  const [today, setToday] = useState(() => todayInTaipei());
  const [range, setRange] = useState<UsageRangeState>(() => defaultRangeState(todayInTaipei()));
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [summary, setSummary] = useState<UsageSummaryResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [options, setOptions] = useState<Options>(emptyOptions);
  const [exportFailed, setExportFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reload, setReload] = useState(0);
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  // Creation dates come from the app's own project list, only to tell apart
  // projects that share a name; the usage API is not involved.
  const [createdAt, setCreatedAt] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    let alive = true;
    listProjects()
      .then((list) => {
        if (alive) setCreatedAt(new Map(list.map((p) => [p.id, p.createdAt])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // A page left open across Taipei midnight: re-read the day whenever the user
  // comes back to it (and once a minute), and carry preset ranges forward.
  useEffect(() => {
    const refresh = () => {
      const now = todayInTaipei();
      setToday((prev) => (prev === now ? prev : now));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    setRange((r) => rederiveRange(r, today));
  }, [today]);

  const compare = compareRangeFor(range);

  const query = useMemo<UsageQuery>(() => {
    const q: UsageQuery = { from: toIso(range.from), to: toIso(range.to) };
    if (range.cmpOn) {
      q.compareFrom = toIso(compare.from);
      q.compareTo = toIso(compare.to);
    }
    if (filters.projectId) q.projectId = filters.projectId;
    if (filters.user) q.user = filters.user;
    if (filters.agentId) q.agentId = filters.agentId;
    if (filters.model) q.model = filters.model;
    return q;
    // `compare` is derived from `range`; depending on range keeps the key stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, filters]);

  const requestSeq = useRef(0);
  useEffect(() => {
    const seq = (requestSeq.current += 1);
    const controller = new AbortController();
    setStatus('loading');
    fetchUsageSummary(query, controller.signal)
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setSummary(res);
        setOptions((prev) => mergeOptions(prev, res));
        setStatus('ready');
      })
      .catch(() => {
        if (seq !== requestSeq.current || controller.signal.aborted) return;
        setStatus('error');
      });
    return () => controller.abort();
  }, [query, reload]);

  const runExport = useCallback(async () => {
    setExporting(true);
    setExportFailed(false);
    try {
      await downloadUsageExport(query);
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  }, [query]);

  const setFilter = (key: keyof Filters) => (value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const projectLabels = useMemo(() => {
    const known = new Map(options.projects);
    for (const p of summary?.projects ?? []) {
      known.set(p.projectId, { name: p.projectName, deleted: p.deleted === true });
    }
    return buildProjectLabels(
      [...known].map(([id, v]) => ({ id, name: v.name, deleted: v.deleted })),
      createdAt,
      t,
    );
  }, [options.projects, summary, createdAt, t]);

  const modelColors = useMemo(() => buildModelColors(summary?.models ?? []), [summary]);

  const showCompare = range.cmpOn && summary?.compareTotals != null;
  const isEmpty =
    summary != null &&
    summary.totals.costUsd === 0 &&
    summary.totals.tokens === 0 &&
    summary.totals.runs === 0;

  return (
    <div className={styles.page} data-testid="usage-view">
      <header className={styles.header}>
        <h1 className={styles.heading}>{t('usage.title')}</h1>
        <UsageDateRangePicker value={range} today={today} onApply={setRange} />
      </header>

      <div className={styles.filters}>
        <FilterSelect
          label={t('usage.filterProject')}
          value={filters.projectId}
          onChange={setFilter('projectId')}
          allLabel={t('usage.allProjects')}
          testId="usage-filter-project"
          options={[
            ...[...options.projects]
              .filter(([id]) => id !== USAGE_NO_PROJECT_ID)
              .map(([id]) => {
                const label = projectLabels.get(id);
                return { value: id, label: label ? plainProjectLabel(label, t) : id };
              }),
            { value: USAGE_NO_PROJECT_ID, label: t('usage.noProject') },
          ]}
        />
        <FilterSelect
          label={t('usage.filterUser')}
          value={filters.user}
          onChange={setFilter('user')}
          allLabel={t('usage.allUsers')}
          testId="usage-filter-user"
          options={[...options.users].map((u) => ({
            value: u,
            label: u === USAGE_AUTOMATIC_USER ? t('usage.automatic') : u,
          }))}
        />
        <FilterSelect
          label={t('usage.filterAgent')}
          value={filters.agentId}
          onChange={setFilter('agentId')}
          allLabel={t('usage.allAgents')}
          testId="usage-filter-agent"
          options={[...options.agents].map((a) => ({ value: a, label: agentDisplayName(a) }))}
        />
        <FilterSelect
          label={t('usage.filterModel')}
          value={filters.model}
          onChange={setFilter('model')}
          allLabel={t('usage.allModels')}
          testId="usage-filter-model"
          options={[...options.models].map((m) => ({ value: m, label: modelDisplayName(m) }))}
        />
        <div className={styles.exportArea}>
          {exportFailed ? (
            <span role="alert" className={styles.exportError} data-testid="usage-export-error">
              <span>{t('usage.exportFailed')}</span>
              <button type="button" className={styles.retry} onClick={() => void runExport()}>
                {t('usage.retry')}
              </button>
            </span>
          ) : null}
          <Button
            variant="ghost"
            className={styles.exportButton}
            disabled={exporting}
            onClick={() => void runExport()}
            data-testid="usage-export"
          >
            <Icon name="download" size={16} />
            {t('usage.export')}
          </Button>
        </div>
      </div>

      {status === 'error' ? (
        <div className={styles.empty} role="alert">
          <span>{t('usage.loadFailed')}</span>
          <button type="button" className={styles.retry} onClick={() => {
              setToday(todayInTaipei());
              setReload((n) => n + 1);
            }}>
            {t('usage.retry')}
          </button>
        </div>
      ) : null}

      {summary && status !== 'error' && isEmpty ? (
        <div className={`${styles.empty} ${status === 'loading' ? styles.stale : ''}`} aria-busy={status === 'loading'} data-testid="usage-empty">{t('usage.empty')}</div>
      ) : null}

      {summary && status !== 'error' && !isEmpty ? (
        <div className={`${styles.content} ${status === 'loading' ? styles.stale : ''}`} aria-busy={status === 'loading'}>
          <div className={styles.kpis}>
            <Kpi
              label={t('usage.kpiCost')}
              value={formatUsd(summary.totals.costUsd)}
              delta={showCompare ? computeDelta(summary.totals.costUsd, summary.compareTotals!.costUsd) : null}
              tone="cost"
              note={
                summary.unpricedModels.length > 0
                  ? t('usage.unpriced', { models: summary.unpricedModels.join('、') })
                  : null
              }
              compareLabel={t(compare.labelKey)}
              testId="usage-kpi-cost"
            />
            <Kpi
              label={t('usage.kpiTokens')}
              value={formatTokens(summary.totals.tokens)}
              unit={t('usage.tokenUnit')}
              delta={showCompare ? computeDelta(summary.totals.tokens, summary.compareTotals!.tokens) : null}
              tone="neutral"
              compareLabel={t(compare.labelKey)}
              testId="usage-kpi-tokens"
            />
            <Kpi
              label={t('usage.kpiRuns')}
              value={formatInt(summary.totals.runs)}
              unit={t('usage.runsUnit')}
              delta={showCompare ? computeDelta(summary.totals.runs, summary.compareTotals!.runs) : null}
              tone="neutral"
              compareLabel={t(compare.labelKey)}
              testId="usage-kpi-runs"
            />
          </div>

          <div className={styles.split}>
            <UsageChart summary={summary} showCompare={showCompare} modelColors={modelColors} />
            <ProjectList
              summary={summary}
              projectLabels={projectLabels}
              expanded={projectsExpanded}
              onToggle={() => setProjectsExpanded((v) => !v)}
            />
          </div>

          <UsagePeople summary={summary} modelColors={modelColors} projectLabels={projectLabels} />
          <UsageDetail summary={summary} modelColors={modelColors} />
          <p className={styles.footnote}>{t('usage.footnote')}</p>
        </div>
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
  testId: string;
}) {
  // A chosen value must stay selectable even if the list has not seen it yet.
  const known = options.some((o) => o.value === value);
  return (
    <label className={styles.filter}>
      <span className={styles.filterLabel}>{label}</span>
      <Select
        className={styles.filterSelect}
        value={value}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{allLabel}</option>
        {!known && value ? <option value={value}>{value}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
    </label>
  );
}

const ARROW_PATH: Record<Delta['direction'], string> = {
  up: 'M7 7h10v10M7 17 17 7',
  down: 'M7 7l10 10M17 7v10',
  flat: 'M5 12h14',
};

function Kpi({
  label,
  value,
  unit,
  delta,
  tone,
  note,
  compareLabel,
  testId,
}: {
  label: string;
  value: string;
  unit?: string;
  delta: Delta | null;
  tone: 'cost' | 'neutral';
  note?: string | null;
  compareLabel: string;
  testId: string;
}) {
  // Spending more is the thing to notice; everything else is plain information.
  const toneClass =
    tone === 'cost' && delta?.direction === 'up'
      ? styles.deltaWarn
      : tone === 'cost' && delta?.direction === 'down'
        ? styles.deltaGood
        : '';
  return (
    <div className={styles.kpi} data-testid={testId}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>
        <span>{value}</span>
        {unit ? <span className={styles.kpiUnit}>{unit}</span> : null}
      </span>
      {note ? (
        <span className={styles.note} data-testid="usage-unpriced">{note}</span>
      ) : null}
      {delta ? (
        <span className={`${styles.delta} ${toneClass}`} data-testid={`${testId}-delta`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={ARROW_PATH[delta.direction]} />
          </svg>
          {delta.text}
          <span className={styles.deltaLabel}>{compareLabel}</span>
        </span>
      ) : null}
    </div>
  );
}

const PROJECT_ROWS_SHOWN = 8;

function ProjectList({
  summary,
  projectLabels,
  expanded,
  onToggle,
}: {
  summary: UsageSummaryResponse;
  projectLabels: ReadonlyMap<string, UsageProjectLabel>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const total = summary.totals.costUsd;
  const cardRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Expanding must not change the page's length: the card keeps the height it
  // had with 8 rows, and every project scrolls inside the list.
  const [frozenHeight, setFrozenHeight] = useState<number | null>(null);
  const shown = expanded ? summary.projects : summary.projects.slice(0, PROJECT_ROWS_SHOWN);
  const hasMore = summary.projects.length > PROJECT_ROWS_SHOWN;

  const toggle = () => {
    if (!expanded) {
      setFrozenHeight(cardRef.current?.offsetHeight ?? null);
    } else {
      setFrozenHeight(null);
      if (listRef.current) listRef.current.scrollTop = 0;
    }
    onToggle();
  };

  const row = (p: UsageSummaryResponse['projects'][number]) => (
    <div key={p.projectId} className={styles.projectRow} data-testid="usage-project-row">
      <span className={styles.projectName}>{projectLabels.get(p.projectId) ? <ProjectName label={projectLabels.get(p.projectId)!} /> : p.projectId}</span>
      <span className={styles.projectRuns}>{formatInt(p.runs)} {t('usage.runsUnit')}</span>
      <span className={styles.projectFigures}>
        <span className={styles.projectCost}>{formatUsd(p.costUsd)}</span>{' '}
        <span className={styles.projectShare}>{formatShare(p.costUsd, total)}</span>
      </span>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.fill} style={{ width: `${total > 0 ? Math.max(2, (p.costUsd / total) * 100) : 0}%` }} />
      </span>
    </div>
  );
  return (
    <section
      ref={cardRef}
      className={styles.projects}
      style={frozenHeight !== null ? { height: frozenHeight } : undefined}
      aria-labelledby="usage-projects-title"
    >
      <h2 id="usage-projects-title" className={styles.cardTitle}>{t('usage.projects')}</h2>
      <div
        ref={listRef}
        id="usage-projects-list"
        className={`${styles.projectRows} ${expanded ? styles.projectRowsScroll : ''}`}
        {...(expanded ? { tabIndex: 0, role: 'region', 'aria-label': t('usage.projects') } : {})}
        data-testid="usage-projects-list"
      >
        {shown.map(row)}
      </div>
      {hasMore ? (
        <button
          type="button"
          className={styles.more}
          aria-expanded={expanded}
          aria-controls="usage-projects-list"
          onClick={toggle}
          data-testid="usage-projects-toggle"
        >
          {expanded ? t('usage.collapse') : t('usage.showAllProjects', { n: summary.projects.length })}
        </button>
      ) : null}
    </section>
  );
}
