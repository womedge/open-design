import { useEffect, useMemo, useState } from 'react';
import { Collapsible } from './Collapsible';
import { USAGE_MAX_RANGE_DAYS } from './usage-model';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-design/components';

import { useT } from '../../i18n';
import { Icon } from '../Icon';
import {
  PRESET_LABEL_KEY,
  PRESET_ORDER,
  compareRangeFor,
  dayCount,
  dayParts,
  daysInMonth,
  daySerial,
  formatDay,
  formatRange,
  monthStart,
  presetRange,
  spanBetween,
  shiftMonths,
  type UsageCompareType,
  type UsageDay,
  type UsagePresetId,
  type UsageRangeState,
} from './usage-dates';
import styles from './UsageDateRangePicker.module.css';

interface Props {
  value: UsageRangeState;
  today: UsageDay;
  onApply: (next: UsageRangeState) => void;
}

interface Draft extends UsageRangeState {
  /** Which range the calendar is editing. */
  editing: 'main' | 'compare';
  /** The next click completes the range (true) or starts a new one (false). */
  mainDone: boolean;
  cmpDone: boolean;
  /** First day of the left-most visible month. */
  cal: UsageDay;
}

const CMP_TYPES: Array<{ id: UsageCompareType; key: string }> = [
  { id: 'previous', key: 'usage.cmpPrevious' },
  { id: 'yearAgo', key: 'usage.cmpYearAgo' },
  { id: 'custom', key: 'usage.cmpCustom' },
];

function usePhoneLayout(): boolean {
  const query = '(max-width: 640px)';
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const sync = () => setPhone(mql.matches);
    sync();
    mql.addEventListener?.('change', sync);
    return () => mql.removeEventListener?.('change', sync);
  }, []);
  return phone;
}

/** Keep the latest month in the right-hand calendar so "now" is visible. */
function calendarStartFor(day: UsageDay, today: UsageDay, months: number): UsageDay {
  const first = monthStart(day);
  if (months > 1 && first >= monthStart(today)) return shiftMonths(first, 1 - months);
  return first;
}

function toDraft(value: UsageRangeState, today: UsageDay, months: number): Draft {
  return {
    ...value,
    editing: 'main',
    mainDone: true,
    cmpDone: true,
    cal: calendarStartFor(value.from, today, months),
  };
}

export function UsageDateRangePicker({ value, today, onApply }: Props) {
  const t = useT();
  const phone = usePhoneLayout();
  const months = phone ? 1 : 2;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(value, today, months));

  const applied = compareRangeFor(value);
  const draftCompare = compareRangeFor(draft);

  const openDialog = () => {
    setDraft(toDraft(value, today, months));
    setOpen(true);
  };

  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }));

  const pickPreset = (id: UsagePresetId) => {
    if (id === 'custom') {
      patch({ preset: 'custom', editing: 'main' });
      return;
    }
    const range = presetRange(id, today);
    patch({
      preset: id,
      ...range,
      mainDone: true,
      editing: 'main',
      cal: calendarStartFor(range.from, today, months),
    });
  };

  const pickCompareType = (id: UsageCompareType) => {
    if (id === 'custom') {
      patch({
        cmpType: 'custom',
        editing: 'compare',
        cmpDone: true,
        cmpFrom: draftCompare.from,
        cmpTo: draftCompare.to,
        cal: calendarStartFor(draftCompare.from, today, months),
      });
      return;
    }
    patch({ cmpType: id, editing: 'main', cal: calendarStartFor(draft.from, today, months) });
  };

  const pickDay = (day: UsageDay) => {
    if (draft.editing === 'compare') {
      if (draft.cmpDone) patch({ cmpFrom: day, cmpTo: day, cmpDone: false });
      else {
        const r = spanBetween(draft.cmpFrom, day, USAGE_MAX_RANGE_DAYS);
        patch({ cmpFrom: r.from, cmpTo: r.to, cmpDone: true });
      }
      return;
    }
    if (draft.mainDone) patch({ from: day, to: day, preset: 'custom', mainDone: false });
    else {
      const r = spanBetween(draft.from, day, USAGE_MAX_RANGE_DAYS);
      patch({ from: r.from, to: r.to, preset: 'custom', mainDone: true });
    }
  };

  const apply = () => {
    const cmp = compareRangeFor(draft);
    onApply({
      preset: draft.preset,
      from: draft.from,
      to: draft.to,
      cmpOn: draft.cmpOn,
      cmpType: draft.cmpType,
      cmpFrom: cmp.from,
      cmpTo: cmp.to,
    });
    setOpen(false);
  };

  const selected =
    draft.editing === 'compare' ? { from: draft.cmpFrom, to: draft.cmpTo } : { from: draft.from, to: draft.to };

  const visibleMonths = useMemo(
    () => Array.from({ length: months }, (_, i) => shiftMonths(draft.cal, i)),
    [draft.cal, months],
  );
  const weekdays = t('usage.dpWeekdays').split(',');

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openDialog}
        data-testid="usage-date-trigger"
      >
        <span className={styles.triggerText}>
          <span className={styles.triggerRange}>
            <svg className={styles.calIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            <span className={styles.num} data-testid="usage-range-text">
              {formatRange(value)}
            </span>
          </span>
          {value.cmpOn ? (
            <span className={styles.triggerCompare} data-testid="usage-compare-text">
              {t('usage.dpCompareWith', { range: formatRange(applied) })}
            </span>
          ) : null}
        </span>
        <span className={styles.chevron} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      {open ? (
        <Dialog
          onClose={() => setOpen(false)}
          closeOnEscape
          layout="sectioned"
          ariaLabelledBy="usage-dp-title"
          className={styles.dialog}
          backdropClassName={styles.backdrop}
          data-testid="usage-date-dialog"
        >
          <DialogHeader className={styles.header}>
            <DialogTitle id="usage-dp-title">{t('usage.dpTitle')}</DialogTitle>
            <Button variant="ghost" size="icon" aria-label={t('usage.dpClose')} onClick={() => setOpen(false)}>
              <Icon name="close" size={16} />
            </Button>
          </DialogHeader>
          <DialogBody className={styles.body}>
            <div className={styles.options}>
              <div className={styles.group}>
                <span className={styles.groupLabel}>{t('usage.dpRange')}</span>
                <div className={styles.optionList}>
                  {PRESET_ORDER.map((id) => (
                    <Button
                      key={id}
                      className={`${styles.option} ${draft.preset === id ? styles.optionOn : ''}`}
                      aria-pressed={draft.preset === id}
                      onClick={() => pickPreset(id)}
                    >
                      {t(PRESET_LABEL_KEY[id] as 'usage.presetToday')}
                    </Button>
                  ))}
                </div>
              </div>
              <div className={styles.group}>
                <div className={styles.switchRow}>
                  <span id="usage-dp-cmp-label" className={styles.groupLabel}>
                    {t('usage.dpCompare')}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.cmpOn}
                    aria-labelledby="usage-dp-cmp-label"
                    className={`${styles.switch} ${draft.cmpOn ? styles.switchOn : ''}`}
                    onClick={() => patch({ cmpOn: !draft.cmpOn, editing: 'main' })}
                  >
                    <span className={styles.thumb} />
                  </button>
                </div>
                <Collapsible open={draft.cmpOn}>
                    <div className={styles.optionList}>
                      {CMP_TYPES.map((c) => (
                        <Button
                          key={c.id}
                          className={`${styles.option} ${draft.cmpType === c.id ? styles.optionOn : ''}`}
                          aria-pressed={draft.cmpType === c.id}
                          onClick={() => pickCompareType(c.id)}
                        >
                          {t(c.key as 'usage.cmpPrevious')}
                        </Button>
                      ))}
                    </div>
                </Collapsible>
              </div>
            </div>

            <div className={styles.calendarSide}>
              <div className={styles.months}>
                {visibleMonths.map((ms, i) => (
                  <Month
                    key={ms}
                    monthFirst={ms}
                    today={today}
                    selected={selected}
                    hasPrev={i === 0}
                    hasNext={i === visibleMonths.length - 1}
                    weekdays={weekdays}
                    onPrev={() => patch({ cal: shiftMonths(draft.cal, -1) })}
                    onNext={() => patch({ cal: shiftMonths(draft.cal, 1) })}
                    onPick={pickDay}
                  />
                ))}
              </div>
              <div className={styles.summaries}>
                <div className={styles.summary}>
                  <span className={styles.summaryText}>
                    {t('usage.dpRangeSummary', {
                      label: t(PRESET_LABEL_KEY[draft.preset] as 'usage.presetToday'),
                      days: dayCount(draft),
                    })}
                  </span>
                  <button
                    type="button"
                    className={`${styles.rangeChip} ${draft.editing === 'main' ? styles.rangeChipOn : ''}`}
                    onClick={() => patch({ editing: 'main', cal: calendarStartFor(draft.from, today, months) })}
                  >
                    <span className={styles.num}>{formatDay(draft.from)}</span>
                    <span aria-hidden="true">→</span>
                    <span className={styles.num}>{formatDay(draft.to)}</span>
                  </button>
                </div>
                <Collapsible open={draft.cmpOn}>
                    <div className={styles.summary}>
                      <span className={styles.summaryText}>
                        {t('usage.dpCompareSummary', {
                          label: t(CMP_TYPES.find((c) => c.id === draft.cmpType)!.key as 'usage.cmpPrevious'),
                          days: dayCount(draftCompare),
                        })}
                      </span>
                      {draft.cmpType === 'custom' ? (
                        <button
                          type="button"
                          className={`${styles.rangeChip} ${draft.editing === 'compare' ? styles.rangeChipOn : ''}`}
                          onClick={() => patch({ editing: 'compare', cal: calendarStartFor(draft.cmpFrom, today, months) })}
                        >
                          <span className={styles.num}>{formatDay(draftCompare.from)}</span>
                          <span aria-hidden="true">→</span>
                          <span className={styles.num}>{formatDay(draftCompare.to)}</span>
                        </button>
                      ) : (
                        <span className={`${styles.rangeChip} ${styles.rangeChipStatic}`}>
                          <span className={styles.num}>{formatDay(draftCompare.from)}</span>
                          <span aria-hidden="true">→</span>
                          <span className={styles.num}>{formatDay(draftCompare.to)}</span>
                        </span>
                      )}
                    </div>
                </Collapsible>
              </div>
            </div>
          </DialogBody>
          <DialogFooter className={styles.footer}>
            <Button onClick={() => setOpen(false)}>{t('usage.dpCancel')}</Button>
            <Button variant="primary" onClick={apply} data-testid="usage-date-apply">
              {t('usage.dpApply')}
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </>
  );
}

interface MonthProps {
  monthFirst: UsageDay;
  today: UsageDay;
  selected: { from: UsageDay; to: UsageDay };
  hasPrev: boolean;
  hasNext: boolean;
  weekdays: string[];
  onPrev: () => void;
  onNext: () => void;
  onPick: (day: UsageDay) => void;
}

function Month({ monthFirst, today, selected, hasPrev, hasNext, weekdays, onPrev, onNext, onPick }: MonthProps) {
  const t = useT();
  const p = dayParts(monthFirst);
  const total = daysInMonth(p.year, p.month0);
  const cells: Array<UsageDay | null> = [];
  for (let i = 0; i < p.weekday; i += 1) cells.push(null);
  for (let d = 1; d <= total; d += 1) cells.push(daySerial(p.year, p.month0, d));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className={styles.month}>
      <div className={styles.monthHead}>
        {hasPrev ? (
          <button type="button" className={styles.nav} aria-label={t('usage.dpPrevMonth')} onClick={onPrev}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>
        ) : (
          <span className={styles.navSpacer} />
        )}
        <span className={styles.monthTitle}>
          {t('usage.dpMonthTitle', { year: p.year, month: p.month0 + 1 })}
        </span>
        {hasNext ? (
          <button type="button" className={styles.nav} aria-label={t('usage.dpNextMonth')} onClick={onNext}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        ) : (
          <span className={styles.navSpacer} />
        )}
      </div>
      <div className={styles.grid} role="grid">
        {weekdays.map((w, i) => (
          <span key={i} className={styles.weekday} aria-hidden="true">{w}</span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`b${i}`} />;
          const dp = dayParts(day);
          const future = day > today;
          const isStart = day === selected.from;
          const isEnd = day === selected.to;
          const inRange = day >= selected.from && day <= selected.to;
          if (future) {
            return (
              <span key={day} className={`${styles.day} ${styles.dayDisabled} ${styles.num}`} aria-hidden="true">
                {dp.day}
              </span>
            );
          }
          const cls = [
            styles.day,
            styles.num,
            inRange ? styles.dayInRange : '',
            isStart || isEnd ? styles.dayEdge : '',
            day === today ? styles.dayToday : '',
          ].join(' ');
          return (
            <button
              key={day}
              type="button"
              className={cls}
              aria-pressed={isStart || isEnd}
              aria-label={t('usage.dpDayLabel', { year: dp.year, month: dp.month0 + 1, day: dp.day })}
              data-day={day}
              onClick={() => onPick(day)}
            >
              {dp.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
