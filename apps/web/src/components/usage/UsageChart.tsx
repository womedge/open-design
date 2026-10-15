import type { UsageSummaryResponse } from '@open-design/contracts';

import { useT } from '../../i18n';
import { formatShortDay, formatRange, fromIso } from './usage-dates';
import { formatUsd, formatUsdShort, modelDisplayName } from './usage-format';
import { colorOfModel, niceAxis } from './usage-model';
import styles from './UsageChart.module.css';

interface Props {
  summary: UsageSummaryResponse;
  showCompare: boolean;
  modelColors: Map<string, string>;
}

function axisLabel(value: number): string {
  return `$${Number(value.toFixed(2))}`;
}

export function UsageChart({ summary, showCompare, modelColors }: Props) {
  const t = useT();
  const { daily, models } = summary;
  const compare = showCompare && summary.compareDaily ? summary.compareDaily : null;
  const totals = daily.map((d) => d.costUsd);
  const peak = Math.max(0, ...totals, ...(compare ? compare.map((c) => c.costUsd) : [0]));
  const axis = niceAxis(peak);
  const n = daily.length;
  const labelEvery = Math.max(1, Math.ceil(n / 10));
  const peakIndex = totals.indexOf(Math.max(...totals));
  const showAllValues = n <= 10;
  // Stack order follows the model list so a model keeps its place and color.
  const order = models.map((m) => m.model);

  const first = daily[0]?.date;
  const last = daily[n - 1]?.date;
  const aria = t('usage.chartAria', {
    range: first && last ? formatRange({ from: fromIso(first), to: fromIso(last) }) : '',
    total: formatUsd(totals.reduce((a, b) => a + b, 0)),
  });

  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  if (compare) {
    for (let i = 0; i < Math.min(compare.length, n) - 1; i += 1) {
      segments.push({
        x1: ((i + 0.5) / n) * 100,
        y1: 100 - (compare[i]!.costUsd / axis.top) * 100,
        x2: ((i + 1.5) / n) * 100,
        y2: 100 - (compare[i + 1]!.costUsd / axis.top) * 100,
      });
    }
  }

  return (
    <section className={styles.card} aria-labelledby="usage-chart-title">
      <div className={styles.head}>
        <h2 id="usage-chart-title" className={styles.title}>{t('usage.dailyCost')}</h2>
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.swatchLine} />
            {t('usage.legendCurrent')}
          </span>
          {compare ? (
            <span className={styles.legendItem}>
              <span className={styles.swatchDash} />
              {t('usage.legendCompare')}
            </span>
          ) : null}
          <span className={styles.legendDivider} aria-hidden="true" />
          {models.map((m) => (
            <span key={m.model} className={styles.legendItem}>
              <span className={styles.swatchBox} style={{ background: colorOfModel(modelColors, m.model) }} />
              {modelDisplayName(m.model)}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.scroller}>
        <div className={styles.chart}>
          <div className={styles.yAxis} aria-hidden="true">
            <span style={{ bottom: 0 }}>$0</span>
            {axis.ticks.map((tick, i) => (
              <span key={tick} style={{ bottom: `${((i + 1) / 3) * 100}%` }}>{axisLabel(tick)}</span>
            ))}
          </div>
          <div className={styles.plotCol}>
            <div className={styles.plot}>
              {[1, 2, 3].map((i) => (
                <div key={i} className={styles.gridLine} style={{ bottom: `${(i / 3) * 100}%` }} />
              ))}
              <div className={styles.bars} role="img" aria-label={aria} data-testid="usage-chart-bars">
                {daily.map((d, i) => {
                  const showValue = d.costUsd > 0 && (showAllValues || i === peakIndex);
                  return (
                    <div
                      key={d.date}
                      className={styles.col}
                      title={`${d.date}  ${formatUsd(d.costUsd)}`}
                      data-testid="usage-chart-col"
                    >
                      {showValue ? <span className={styles.value}>{formatUsdShort(d.costUsd)}</span> : null}
                      <div className={styles.stack} style={{ height: `${(d.costUsd / axis.top) * 100}%` }}>
                        {order.map((model) => {
                          const cost = d.byModel[model] ?? 0;
                          if (!(cost > 0)) return null;
                          return (
                            <span
                              key={model}
                              className={styles.seg}
                              style={{ flexGrow: cost, background: colorOfModel(modelColors, model) }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              {segments.length ? (
                <svg className={styles.cmpLine} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-testid="usage-chart-compare">
                  {segments.map((s, i) => (
                    <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} vectorEffect="non-scaling-stroke" />
                  ))}
                </svg>
              ) : null}
            </div>
            <div className={styles.xAxis} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden="true">
              {daily.map((d, i) => (
                <span key={d.date} className={styles.xLabel}>
                  {i % labelEvery === 0 ? formatShortDay(fromIso(d.date)) : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
