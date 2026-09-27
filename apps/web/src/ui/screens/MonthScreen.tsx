import { parseDate, WEEKDAY_LABELS } from '@ito/core/jst';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../primitives/Controls';
import ScheduleEventRow from '../primitives/ScheduleEventRow';
import type { MemberVM, MonthCellVM, MonthScreenProps, MonthSpanVM, MonthVM } from '../types';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** セルの短い予定名の色（担当の最初の人の色。全員なら無彩色） */
const itemColor = (item: MonthCellVM['items'][number], members: MemberVM[]) => {
  if (item.forEveryone) return 'everyone';
  return members.find((member) => member.id === item.memberIds[0])?.color ?? 'everyone';
};

const spanColor = (span: MonthSpanVM, members: MemberVM[]) => {
  if (span.forEveryone) return 'everyone';
  return members.find((member) => member.id === span.memberIds[0])?.color ?? 'everyone';
};

/** 同じ中身の短い予定名が並んでも key がぶつからないように */
function keyed<T>(items: T[], keyOf: (item: T) => string): { item: T; key: string }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = keyOf(item);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { item, key: n === 1 ? base : `${base}#${n}` };
  });
}

function MonthGrid({
  month,
  members,
  selectedDate,
  onSelectDate,
  onSwipe,
}: {
  month: MonthVM;
  members: MemberVM[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onSwipe: (direction: -1 | 1) => void;
}) {
  const touchStart = useRef<number | undefined>(undefined);
  return (
    <div
      className="month-grid-wrap"
      onTouchEnd={(event) => {
        if (touchStart.current === undefined) return;
        const distance = (event.changedTouches[0]?.clientX ?? 0) - touchStart.current;
        if (Math.abs(distance) > 48) onSwipe(distance < 0 ? 1 : -1);
        touchStart.current = undefined;
      }}
      onTouchStart={(event) => {
        touchStart.current = event.touches[0]?.clientX;
      }}
    >
      <div className="month-weekday-row">
        {month.weekdayLabels.map((weekday) => (
          <span
            className={
              weekday === '日' ? 'month-weekday--sun' : weekday === '土' ? 'month-weekday--sat' : ''
            }
            key={weekday}
          >
            {weekday}
          </span>
        ))}
      </div>
      <div className="month-weeks">
        {month.weeks.map((week, weekIndex) => {
          const spans = month.spans.filter((span) => span.week === weekIndex).slice(0, 2);
          return (
            <div className="month-week-row" key={week[0]?.date ?? weekIndex}>
              {week.map((cell) => {
                const { month: m, day } = parseDate(cell.date);
                return (
                  <Button
                    aria-label={`${m}月${day}日${cell.holiday ? ` ${cell.holiday}` : ''}を選ぶ`}
                    aria-pressed={cell.date === selectedDate}
                    className={`month-cell ${cell.inMonth ? '' : 'month-cell--outside'}`}
                    data-date={cell.date}
                    key={cell.date}
                    onClick={() => onSelectDate(cell.date)}
                  >
                    <span
                      className={`month-cell-number ${
                        cell.weekday === 0 || cell.holiday
                          ? 'month-cell-number--sun'
                          : cell.weekday === 6
                            ? 'month-cell-number--sat'
                            : ''
                      } ${cell.isToday ? 'month-cell-number--today' : ''} ${
                        cell.date === selectedDate ? 'month-cell-number--selected' : ''
                      }`}
                    >
                      {cell.day}
                    </span>
                    <span className="month-cell-events">
                      {keyed(cell.items, (it) => `${it.title ?? ''}:${it.memberIds.join(',')}`).map(
                        ({ item, key }) => (
                          <span
                            className={`month-event month-event--${itemColor(item, members)}`}
                            key={key}
                          >
                            {item.title ?? '予定あり'}
                          </span>
                        ),
                      )}
                      {cell.more > 0 && <span className="month-more">+{cell.more}</span>}
                    </span>
                  </Button>
                );
              })}
              <div className="month-span-layer" aria-hidden="true">
                {spans.map((span, index) => (
                  <i
                    className={`month-span month-span--level-${index} month-span--${spanColor(span, members)}`}
                    key={span.key}
                    style={{ gridColumn: `${span.fromCol + 1} / ${span.toCol + 2}`, gridRow: 1 }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthPicker({
  year: initialYear,
  month,
  onClose,
  onPick,
}: {
  year: number;
  month: number;
  onClose: () => void;
  onPick: (year: number, month: number) => void;
}) {
  const [year, setYear] = useState(initialYear);
  return (
    <div className="sheet-backdrop">
      <section className="bottom-sheet month-picker" aria-label="年月を選ぶ">
        <div className="sheet-title">
          <Button aria-label="前の年" onClick={() => setYear(year - 1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <strong>{year}年</strong>
          <Button aria-label="次の年" onClick={() => setYear(year + 1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button aria-label="閉じる" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="month-picker-grid">
          {MONTHS.map((m) => (
            <Button
              aria-pressed={year === initialYear && month === m}
              key={`${year}-${m}`}
              onClick={() => onPick(year, m)}
            >
              {m}月
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}

/** S-02 月（上半分）＋ S-03 選んだ日の予定（下半分） */
export default function MonthScreen(props: MonthScreenProps) {
  const { month, members, selectedDate, selectedDay } = props;
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected = parseDate(selectedDate);
  const rows = [
    ...selectedDay.allDay.map((a) => ({ occ: a.occ, past: false })),
    ...selectedDay.timed.map((t) => ({ occ: t.occ, past: t.past })),
  ];

  return (
    <>
      <header className="month-header">
        <Button aria-label="前の月" onClick={props.onPrevMonth}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          aria-expanded={pickerOpen}
          aria-label={`${month.label}（${month.wafu}）年月を選ぶ`}
          className="month-title"
          onClick={() => setPickerOpen((open) => !open)}
        >
          <span>{month.year}年</span>
          <strong>{month.month}月</strong>
        </Button>
        <Button aria-label="次の月" onClick={props.onNextMonth}>
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button className="month-today-button" onClick={props.onToday}>
          今日
        </Button>
      </header>

      <MonthGrid
        members={members}
        month={month}
        onSelectDate={props.onSelectDate}
        onSwipe={(direction) => (direction < 0 ? props.onPrevMonth() : props.onNextMonth())}
        selectedDate={selectedDate}
      />

      <section className="selected-day-panel" aria-label="選んだ日の予定">
        <header>
          <div>
            <strong>
              {selected.month}月{selected.day}日
            </strong>
            <span>{WEEKDAY_LABELS[selectedDay.weekday]}曜日</span>
            {selectedDay.holiday && <em>{selectedDay.holiday}</em>}
          </div>
          <Button onClick={() => props.onComposeOnDate(selectedDate)}>＋ この日に書く</Button>
        </header>
        <div className="selected-day-events">
          {rows.length ? (
            rows.map((row) => (
              <ScheduleEventRow
                continuingIds={selectedDay.ongoingMemberIds}
                key={row.occ.key}
                members={members}
                occ={row.occ}
                onOpen={() => props.onOpenOccurrence(row.occ.key)}
                past={row.past}
              />
            ))
          ) : (
            <div className="month-empty-day">
              <span>予定はありません</span>
              <Button onClick={() => props.onComposeOnDate(selectedDate)}>＋ 書く</Button>
            </div>
          )}
        </div>
      </section>

      {pickerOpen && (
        <MonthPicker
          month={month.month}
          onClose={() => setPickerOpen(false)}
          onPick={(year, m) => {
            setPickerOpen(false);
            props.onPickMonth(year, m);
          }}
          year={month.year}
        />
      )}
    </>
  );
}
