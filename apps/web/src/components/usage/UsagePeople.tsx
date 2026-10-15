import { useState } from 'react';
import { USAGE_AUTOMATIC_USER } from '@open-design/contracts';
import type { UsagePersonRow, UsageSummaryResponse } from '@open-design/contracts';

import { useT } from '../../i18n';
import { formatShortDay, fromIso } from './usage-dates';
import { formatInt, formatTokens, formatUsd, modelDisplayName } from './usage-format';
import { colorOfModel, projectLabel, userInitial } from './usage-model';
import styles from './UsagePeople.module.css';

interface Props {
  summary: UsageSummaryResponse;
  modelColors: Map<string, string>;
}

export function UsagePeople({ summary, modelColors }: Props) {
  const t = useT();
  const [openUser, setOpenUser] = useState<string | null>(null);
  const projectNames = new Map(
    summary.projects.map((p) => [p.projectId, projectLabel(p.projectId, p.projectName, t)]),
  );

  return (
    <section className={styles.card} aria-labelledby="usage-people-title">
      <h2 id="usage-people-title" className={styles.title}>{t('usage.people')}</h2>
      {summary.people.map((p) => {
        const open = openUser === p.user;
        const auto = p.user === USAGE_AUTOMATIC_USER;
        const panelId = `usage-person-${encodeURIComponent(p.user)}`;
        return (
          <div key={p.user} className={styles.person} data-testid="usage-person">
            <button
              type="button"
              className={`${styles.row} ${open ? styles.rowOpen : ''}`}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpenUser(open ? null : p.user)}
            >
              <span className={auto ? styles.autoMark : styles.avatar} aria-hidden="true">
                {auto ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="8" />
                    <path d="M12 8v4l3 2" />
                  </svg>
                ) : (
                  userInitial(p.user)
                )}
              </span>
              <span className={styles.name}>{auto ? t('usage.automatic') : p.user}</span>
              <span className={styles.end}>
              <span className={styles.figures}>
                <span className={styles.cost}>{formatUsd(p.costUsd)}</span>
                <span className={styles.sub}>
                  {formatInt(p.runs)} {t('usage.runsUnit')} · {formatTokens(p.tokens)}
                </span>
              </span>
              <svg className={`${styles.chev} ${open ? styles.chevOpen : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
              </span>
            </button>
            <div id={panelId} className={`accordion-collapsible ${open ? 'open' : ''}`}>
              <div className="accordion-collapsible-inner">
                {open ? <PersonDetail person={p} projectNames={projectNames} modelColors={modelColors} /> : null}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function PersonDetail({
  person,
  projectNames,
  modelColors,
}: {
  person: UsagePersonRow;
  projectNames: Map<string, string>;
  modelColors: Map<string, string>;
}) {
  const t = useT();
  const projectMax = Math.max(0, ...person.projects.map((x) => x.costUsd));
  const modelTotal = person.models.reduce((a, m) => a + m.costUsd, 0);
  const days = person.daily.filter((d) => d.costUsd > 0);
  const dayMax = Math.max(0, ...days.map((d) => d.costUsd));
  return (
    <div className={styles.detail}>
      <div>
        <h3 className={styles.subTitle}>{t('usage.byProject')}</h3>
        {person.projects.map((x) => (
          <div key={x.key} className={styles.item}>
            <span className={styles.itemName}>{projectNames.get(x.key) ?? x.key}</span>
            <span className={styles.itemValue}>{formatUsd(x.costUsd)}</span>
            <span className={styles.track}>
              <span className={styles.fill} style={{ width: `${projectMax ? (x.costUsd / projectMax) * 100 : 0}%` }} />
            </span>
          </div>
        ))}
      </div>
      <div>
        <h3 className={styles.subTitle}>{t('usage.byModel')}</h3>
        <div className={styles.stackBar}>
          {person.models.map((m) => (
            <span
              key={m.key}
              style={{ flexGrow: m.costUsd, background: colorOfModel(modelColors, m.key) }}
              title={modelDisplayName(m.key)}
            />
          ))}
        </div>
        {person.models.map((m) => (
          <div key={m.key} className={styles.item}>
            <span className={styles.itemName}>
              <span className={styles.dot} style={{ background: colorOfModel(modelColors, m.key) }} />
              {modelDisplayName(m.key)}
            </span>
            <span className={styles.itemValue}>
              {formatUsd(m.costUsd)}
              {modelTotal ? <span className={styles.muted}> {Math.round((m.costUsd / modelTotal) * 100)}%</span> : null}
            </span>
          </div>
        ))}
      </div>
      <div>
        <h3 className={styles.subTitle}>{t('usage.byDay')}</h3>
        <div className={styles.days}>
          {days.map((d) => (
            <div key={d.date} className={styles.item}>
              <span className={styles.itemName}>{formatShortDay(fromIso(d.date))}</span>
              <span className={styles.itemValue}>{formatUsd(d.costUsd)}</span>
              <span className={styles.track}>
                <span className={styles.fill} style={{ width: `${dayMax ? (d.costUsd / dayMax) * 100 : 0}%` }} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
