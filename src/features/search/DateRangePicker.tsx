import { useId, useRef, useState } from 'react';

interface DateRangePickerProps {
  from: string | undefined;
  to: string | undefined;
  minimumAvailableDate: string;
  maximumAvailableDate: string;
  onChange: (range: { from?: string; to?: string }) => void;
}

const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'] as const;

export function DateRangePicker({
  from,
  to,
  minimumAvailableDate,
  maximumAvailableDate,
  onChange,
}: DateRangePickerProps): React.JSX.Element {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [selectingEnd, setSelectingEnd] = useState(Boolean(from && !to));
  const [visibleMonth, setVisibleMonth] = useState(() => monthKey(to ?? from ?? maximumAvailableDate));
  const month = calendarMonth(visibleMonth);
  const rangeLabel = formatRangeLabel(from, to);

  const openPicker = (): void => {
    setVisibleMonth(monthKey(to ?? from ?? maximumAvailableDate));
    setSelectingEnd(Boolean(from && !to));
    setOpen(true);
  };

  const chooseDate = (date: string): void => {
    if (!from || to || !selectingEnd) {
      onChange({ from: date });
      setSelectingEnd(true);
      return;
    }
    onChange(date < from ? { from: date, to: from } : { from, to: date });
    setSelectingEnd(false);
  };

  const updateFrom = (value: string): void => {
    if (!value) {
      onChange(to ? { to } : {});
      setSelectingEnd(false);
      return;
    }
    setVisibleMonth(monthKey(value));
    if (to && value > to) onChange({ from: value });
    else onChange({ from: value, ...(to ? { to } : {}) });
    setSelectingEnd(true);
  };

  const updateTo = (value: string): void => {
    if (!value) {
      onChange(from ? { from } : {});
      setSelectingEnd(Boolean(from));
      return;
    }
    setVisibleMonth(monthKey(value));
    if (from && value < from) onChange({ from: value, to: from });
    else onChange({ ...(from ? { from } : {}), to: value });
    setSelectingEnd(false);
  };

  const applyPreset = (preset: '30-days' | 'one-year' | 'this-year' | 'all'): void => {
    if (preset === 'all') {
      onChange({});
      setSelectingEnd(false);
      return;
    }
    const nextTo = maximumAvailableDate;
    const nextFrom = preset === '30-days'
      ? addDays(nextTo, -29)
      : preset === 'one-year'
        ? addDays(nextTo, -364)
        : `${nextTo.slice(0, 4)}-01-01`;
    onChange({ from: nextFrom < minimumAvailableDate ? minimumAvailableDate : nextFrom, to: nextTo });
    setVisibleMonth(monthKey(nextTo));
    setSelectingEnd(false);
  };

  return (
    <div
      className="date-range-picker"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <button
        ref={triggerRef}
        className="date-range-trigger"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => open ? setOpen(false) : openPicker()}
      >
        <CalendarIcon />
        <span>
          <small>公開日の範囲</small>
          <strong>{rangeLabel}</strong>
        </span>
        <span className="date-range-trigger-arrow" aria-hidden="true">⌄</span>
      </button>

      {open && (
        <section id={panelId} className="date-range-panel" aria-label="公開日の範囲を選択">
          <div className="date-range-inputs">
            <label>
              <span>開始日</span>
              <input
                type="date"
                value={from ?? ''}
                onChange={(event) => updateFrom(event.target.value)}
              />
            </label>
            <span aria-hidden="true">→</span>
            <label>
              <span>終了日</span>
              <input
                type="date"
                value={to ?? ''}
                onChange={(event) => updateTo(event.target.value)}
              />
            </label>
          </div>

          <div className="date-range-presets" aria-label="公開日のクイック選択">
            <button type="button" onClick={() => applyPreset('30-days')}>過去30日</button>
            <button type="button" onClick={() => applyPreset('one-year')}>過去1年</button>
            <button type="button" onClick={() => applyPreset('this-year')}>今年</button>
            <button type="button" onClick={() => applyPreset('all')}>すべて</button>
          </div>

          <div className="calendar-header">
            <button
              type="button"
              aria-label="前の月"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))}
            >
              ←
            </button>
            <h4 aria-live="polite">{month.year}年{month.month}月</h4>
            <button
              type="button"
              aria-label="次の月"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))}
            >
              →
            </button>
          </div>

          <p className="calendar-instruction">
            {selectingEnd ? '終了日を選んでください' : '開始日を選び、続けて終了日を選択します'}
          </p>
          <div className="calendar-grid" aria-label={`${month.year}年${month.month}月`}>
            {weekdayLabels.map((weekday) => <span className="calendar-weekday" key={weekday}>{weekday}</span>)}
            {Array.from({ length: month.offset }, (_, index) => <span className="calendar-empty" aria-hidden="true" key={`empty-${index}`} />)}
            {month.dates.map((date) => {
              const isStart = date === from;
              const isEnd = date === to;
              const inRange = Boolean(from && to && date >= from && date <= to);
              const className = [
                'calendar-day-cell',
                inRange ? 'is-in-range' : '',
                isStart ? 'is-start' : '',
                isEnd ? 'is-end' : '',
              ].filter(Boolean).join(' ');
              return (
                <span className={className} key={date}>
                  <button
                    type="button"
                    aria-label={dateAriaLabel(date, isStart, isEnd)}
                    aria-pressed={inRange || isStart || isEnd}
                    onClick={() => chooseDate(date)}
                  >
                    {Number(date.slice(-2))}
                  </button>
                </span>
              );
            })}
          </div>

          <div className="date-range-panel-footer">
            <span aria-live="polite">{rangeLabel}</span>
            <button className="button secondary" type="button" onClick={() => setOpen(false)}>完了</button>
          </div>
        </section>
      )}
    </div>
  );
}

function CalendarIcon(): React.JSX.Element {
  return (
    <svg className="date-range-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function calendarMonth(value: string): { year: number; month: number; offset: number; dates: string[] } {
  const [year, month] = value.split('-').map(Number) as [number, number];
  const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    year,
    month,
    offset,
    dates: Array.from({ length: dayCount }, (_, index) => `${year}-${pad(month)}-${pad(index + 1)}`),
  };
}

function addMonths(value: string, amount: number): string {
  const [year, month] = value.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

function addDays(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function formatRangeLabel(from?: string, to?: string): string {
  if (!from && !to) return '指定なし';
  if (from && to) return `${formatDateKey(from)} — ${formatDateKey(to)}`;
  if (from) return `${formatDateKey(from)} 以降`;
  return `${formatDateKey(to!)} 以前`;
}

function formatDateKey(value: string): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return `${year}/${month}/${day}`;
}

function dateAriaLabel(value: string, isStart: boolean, isEnd: boolean): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const state = isStart && isEnd ? '、開始日と終了日' : isStart ? '、開始日' : isEnd ? '、終了日' : '';
  return `${year}年${month}月${day}日${state}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
