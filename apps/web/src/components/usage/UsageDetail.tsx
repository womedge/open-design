import { Collapsible } from './Collapsible';
import { useUsageUiState } from './usage-ui-state';
import type { UsageSummaryResponse } from '@open-design/contracts';

import { useT } from '../../i18n';
import { agentDisplayName, formatInt, formatPrice, formatUsd, modelDisplayName } from './usage-format';
import { colorOfModel, type TKey } from './usage-model';
import styles from './UsageDetail.module.css';

interface Props {
  summary: UsageSummaryResponse;
  modelColors: Map<string, string>;
}

const TOKEN_COLUMNS: Array<{ key: 'input' | 'cacheWrite5m' | 'cacheWrite1h' | 'cacheRead' | 'output'; label: TKey }> = [
  { key: 'input', label: 'usage.colInput' },
  { key: 'cacheWrite5m', label: 'usage.colCacheWrite5m' },
  { key: 'cacheWrite1h', label: 'usage.colCacheWrite1h' },
  { key: 'cacheRead', label: 'usage.colCacheRead' },
  { key: 'output', label: 'usage.colOutput' },
];

export function UsageDetail({ summary, modelColors }: Props) {
  const t = useT();
  const [open, setOpen] = useUsageUiState('detailOpen');
  const priceDates = new Set(summary.prices.map((p) => p.effectiveFrom));
  const singleDate = priceDates.size === 1 ? [...priceDates][0]! : null;

  return (
    <section className={styles.section} aria-labelledby="usage-detail-title">
      <h2 id="usage-detail-title" className={styles.heading}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls="usage-detail-body"
          onClick={() => setOpen((v) => !v)}
        >
          {t('usage.detail')}
          <svg className={`${styles.chev} ${open ? styles.chevOpen : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h2>
      <Collapsible id="usage-detail-body" open={open}>
          <div className={styles.body}>
            <div className={styles.block}>
              <h3 className={styles.blockTitle}>{t('usage.models')}</h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t('usage.colModel')}</th>
                      {TOKEN_COLUMNS.map((c) => (
                        <th key={c.key} scope="col">{t(c.label)}</th>
                      ))}
                      <th scope="col">{t('usage.colCost')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.models.map((m) => (
                      <tr key={m.model}>
                        <th scope="row">
                          <span className={styles.modelName}>
                            <span className={styles.dot} style={{ background: colorOfModel(modelColors, m.model) }} />
                            {modelDisplayName(m.model)}
                          </span>
                          <span className={styles.modelMeta}>
                            {m.agentIds.map(agentDisplayName).join('、')} · {formatInt(m.runs)} {t('usage.runsUnit')}
                          </span>
                        </th>
                        {TOKEN_COLUMNS.map((c) => (
                          <td key={c.key}>{formatInt(m.tokens[c.key])}</td>
                        ))}
                        <td>{formatUsd(m.costUsd)}</td>
                      </tr>
                    ))}
                    <tr className={styles.totalRow}>
                      <th scope="row">{t('usage.total')}</th>
                      {TOKEN_COLUMNS.map((c) => (
                        <td key={c.key}>{formatInt(summary.modelTokenTotals[c.key])}</td>
                      ))}
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className={styles.block}>
              <div className={styles.blockHead}>
                <h3 className={styles.blockTitle}>
                  {t('usage.prices')} <span className={styles.unit}>{t('usage.pricesUnit')}</span>
                </h3>
                {singleDate ? <span className={styles.since}>{t('usage.pricesSince', { date: singleDate })}</span> : null}
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t('usage.colModel')}</th>
                      {TOKEN_COLUMNS.map((c) => (
                        <th key={c.key} scope="col">{t(c.label)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.prices.map((p) => (
                      <tr key={`${p.model}@${p.effectiveFrom}`}>
                        <th scope="row">
                          <span className={styles.modelName}>{modelDisplayName(p.model)}</span>
                          {singleDate ? null : (
                            <span className={styles.modelMeta}>{t('usage.pricesSince', { date: p.effectiveFrom })}</span>
                          )}
                        </th>
                        <td>{formatPrice(p.input)}</td>
                        <td>{p.cacheWrite5m > 0 ? formatPrice(p.cacheWrite5m) : '—'}</td>
                        <td>{p.cacheWrite1h > 0 ? formatPrice(p.cacheWrite1h) : '—'}</td>
                        <td>{formatPrice(p.cacheRead)}</td>
                        <td>{formatPrice(p.output)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
      </Collapsible>
    </section>
  );
}
