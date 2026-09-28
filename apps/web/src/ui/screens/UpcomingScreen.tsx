import {
  addDays,
  addMonths,
  type DateISO,
  daysInMonth,
  firstOfMonth,
  parseDate,
  WEEKDAY_LABELS,
  weekdayOf,
} from '@ito/core/jst';
import { CalendarDays, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BottomSlot } from '../primitives/AppShell';
import { Button } from '../primitives/Controls';
import ScheduleEventRow from '../primitives/ScheduleEventRow';
import ThreadRail from '../primitives/ThreadRail';
import type { DayVM, FlowScreenProps, MemberVM, MonthCellVM } from '../types';

/** 上下の端からこの距離（px）まで来たら、続きを読む */
const EDGE_PX = 200;

const weekendClass = (weekday: number, holiday: string | null) =>
  weekday === 0 || holiday ? 'sun' : weekday === 6 ? 'sat' : '';

function DayHeader({
  day,
  members,
  onAdd,
}: {
  day: DayVM;
  members: MemberVM[];
  onAdd: () => void;
}) {
  const { month, day: dom } = parseDate(day.date);
  return (
    <div className={`timeline-row day-header ${day.isToday ? 'day-header--today' : ''}`}>
      <ThreadRail continuingIds={day.ongoingMemberIds} members={members} />
      <div className="day-heading">
        <span className={`day-number day-number--${weekendClass(day.weekday, day.holiday)}`}>
          {dom}
        </span>
        <span className="weekday">{WEEKDAY_LABELS[day.weekday]}曜日</span>
        {day.holiday && <span className="holiday">{day.holiday}</span>}
        {day.isToday && <span className="today-label">今日</span>}
        <Button aria-label={`${month}月${dom}日に予定を書く`} onClick={onAdd}>
          ＋
        </Button>
      </div>
    </div>
  );
}

function weekRangeLabel(week: MonthCellVM[]): string {
  const first = week[0];
  const last = week[week.length - 1];
  if (!first || !last) return '';
  const a = parseDate(first.date);
  const b = parseDate(last.date);
  return `${a.month}月${a.day}日 — ${b.month}月${b.day}日`;
}

function WeekStrip({
  week,
  members,
  selectedDate,
  datePickerOpen,
  onJumpToDate,
  onPrevWeek,
  onNextWeek,
  onToggleDatePicker,
}: {
  week: MonthCellVM[];
  members: MemberVM[];
  selectedDate: DateISO;
  datePickerOpen: boolean;
  onJumpToDate: (date: DateISO) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToggleDatePicker: () => void;
}) {
  return (
    <section className="week-panel" aria-label="週を選ぶ">
      <div className="week-tools">
        <Button aria-label="前の週" onClick={onPrevWeek}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span>{weekRangeLabel(week)}</span>
        <Button aria-label="次の週" onClick={onNextWeek}>
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button aria-expanded={datePickerOpen} onClick={onToggleDatePicker}>
          <CalendarDays aria-hidden="true" />
          日付
        </Button>
      </div>
      <div className="week-days">
        {week.map((cell) => {
          const { month, day } = parseDate(cell.date);
          const weekday = WEEKDAY_LABELS[cell.weekday];
          return (
            <Button
              aria-current={cell.date === selectedDate ? 'date' : undefined}
              aria-label={`${month}月${day}日 ${weekday}曜日へ移動`}
              className={`${cell.isToday ? 'week-day--today' : ''} ${
                cell.date === selectedDate ? 'week-day--selected' : ''
              }`}
              key={cell.date}
              onClick={() => onJumpToDate(cell.date)}
            >
              <small>{weekday}</small>
              <strong>{day}</strong>
              <span className="week-dots" aria-hidden="true">
                {members.map((member) =>
                  cell.memberIds.includes(member.id) ? (
                    <i className={`dot--${member.color}`} key={member.id} />
                  ) : null,
                )}
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}

/** 日付を選ぶ（「日付」ボタンから。前後の月へ移れる） */
function DatePicker({
  initialDate,
  today,
  weekStart,
  onClose,
  onSelectDate,
}: {
  initialDate: DateISO;
  today: DateISO | null;
  weekStart: 0 | 1;
  onClose: () => void;
  onSelectDate: (date: DateISO) => void;
}) {
  const [shown, setShown] = useState(() => {
    const { year, month } = parseDate(initialDate);
    return firstOfMonth(year, month);
  });
  const { year, month } = parseDate(shown);
  const blanks = (weekdayOf(shown) - weekStart + 7) % 7;
  const labels = [...WEEKDAY_LABELS.slice(weekStart), ...WEEKDAY_LABELS.slice(0, weekStart)];
  const days = daysInMonth(year, month);
  const move = (delta: number) => setShown(addMonths(shown, delta));
  return (
    <div className="sheet-backdrop">
      <section className="bottom-sheet date-picker" aria-label="日付を選択">
        <div className="sheet-title">
          <Button aria-label="前の月" onClick={() => move(-1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <strong>
            {year}年{month}月
          </strong>
          <Button aria-label="次の月" onClick={() => move(1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button aria-label="閉じる" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="month-weekdays">
          {labels.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="month-grid">
          {Array.from({ length: blanks }, (_, i) => addDays(shown, i - blanks)).map((date) => (
            <span key={date} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const date = addDays(shown, i);
            return (
              <Button
                aria-label={`${month}月${i + 1}日`}
                className={date === today ? 'month-day--today' : ''}
                key={date}
                onClick={() => onSelectDate(date)}
              >
                {i + 1}
              </Button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function hasAnyOccurrence(items: FlowScreenProps['items']): boolean {
  return items.some(
    (item) => item.kind === 'day' && (item.day.allDay.length > 0 || item.day.timed.length > 0),
  );
}

/** S-01 これから */
export default function UpcomingScreen(props: FlowScreenProps) {
  const {
    items,
    members,
    anchorKey,
    headerDateLabel,
    summary,
    freshCount,
    week,
    selectedDate,
    sync,
    filterMemberIds,
    unreadActivity,
    showBackToToday,
    notice,
    emptyExamples,
  } = props;
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const scrollRef = useRef<HTMLElement | null>(null);
  const me = members.find((m) => m.isMe);
  // 見出しは今日（'2026年 9月27日 日曜日'）。年も今日から（移動した日の年ではない）
  const [yearPart, datePart, weekdayPart] = headerDateLabel.split(' ');
  const todayItem = items.find((item) => item.kind === 'day' && item.day.isToday);
  const today =
    todayItem?.kind === 'day'
      ? todayItem.day.date
      : (week.find((cell) => cell.isToday)?.date ?? null);
  const weekStart = (week[0]?.weekday === 1 ? 1 : 0) as 0 | 1;
  // 今日の日の見出しが見えなくなったら「今日に戻る」を出す（指でスクロールして離れたときも。§6.3）
  const [awayFromToday, setAwayFromToday] = useState(false);

  // 初回表示で今日を先頭に合わせる
  useEffect(() => {
    const el = scrollRef.current?.querySelector(`[data-item-key="${CSS.escape(anchorKey)}"]`);
    el?.scrollIntoView({ block: 'start' });
  }, [anchorKey]);

  // 上下の端で追加読み込み（利用者がスクロールしたときだけ。最初に今日へ合わせたスクロールでは読まない）。
  // 足すとき・反対側を削るとき（§19）は、見えている最初の行の位置を覚えておき、描き直したあとに合わせる
  // （Safari にはスクロールアンカーがない）
  const userScrolled = useRef(false);
  const pendingAnchor = useRef<{ key: string; top: number } | null>(null);
  const reachStart = useRef(props.onReachStart);
  const reachEnd = useRef(props.onReachEnd);
  reachStart.current = props.onReachStart;
  reachEnd.current = props.onReachEnd;
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const markUser = () => {
      userScrolled.current = true;
      // 一覧が画面に収まってスクロールできないときも、触ったら続きを読む
      if (root.scrollHeight - root.clientHeight < EDGE_PX) reachEnd.current();
    };
    const captureAnchor = () => {
      if (pendingAnchor.current !== null) return false;
      const rootTop = root.getBoundingClientRect().top;
      for (const el of root.querySelectorAll<HTMLElement>('[data-item-key]')) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom <= rootTop) continue;
        const anchor = { key: el.dataset.itemKey ?? '', top: rect.top - rootTop };
        pendingAnchor.current = anchor;
        // これ以上広げられなかったとき（一覧が変わらないとき）は、位置の保持をやめる
        window.setTimeout(() => {
          if (pendingAnchor.current === anchor) pendingAnchor.current = null;
        }, 500);
        return true;
      }
      return false;
    };
    const onScroll = () => {
      if (!userScrolled.current) return;
      if (root.scrollTop < EDGE_PX && captureAnchor()) reachStart.current();
      if (root.scrollHeight - root.scrollTop - root.clientHeight < EDGE_PX && captureAnchor())
        reachEnd.current();
    };
    const inputs = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    for (const type of inputs) root.addEventListener(type, markUser, { passive: true });
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      for (const type of inputs) root.removeEventListener(type, markUser);
      root.removeEventListener('scroll', onScroll);
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 一覧が作り直されると今日の見出しの要素も変わるので、見張り直す
  useEffect(() => {
    const root = scrollRef.current;
    const target = today ? root?.querySelector(`#date-${CSS.escape(today)}`) : null;
    if (!root || !target || typeof IntersectionObserver === 'undefined') {
      setAwayFromToday(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setAwayFromToday(!entry.isIntersecting && userScrolled.current);
      },
      { root },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [today, items]);

  // 足した・削ったあとは、見ていた行を同じ位置に戻す
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const anchor = pendingAnchor.current;
    if (!root || anchor === null || items.length === 0) return;
    pendingAnchor.current = null;
    const el = root.querySelector<HTMLElement>(`[data-item-key="${CSS.escape(anchor.key)}"]`);
    if (!el) return;
    root.scrollTop +=
      el.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.top;
  }, [items]);

  const filters: { id: string; label: string; value: string[] | null }[] = [
    { id: 'all', label: '全員', value: null },
    ...(me ? [{ id: 'self', label: '自分', value: [me.id] }] : []),
    ...members
      .filter((member) => !member.isMe)
      .map((member) => ({ id: member.id, label: member.mark, value: [member.id] })),
  ];
  const pressed = (value: string[] | null) =>
    value === null ? filterMemberIds === null : filterMemberIds?.[0] === value[0];

  return (
    <>
      {notice && (
        <div className="install-prompt" role="note">
          <span>{notice.message}</span>
          <Button onClick={props.onNoticeAction}>{notice.actionLabel}</Button>
          <Button aria-label="案内を閉じる" onClick={props.onNoticeDismiss}>
            <X aria-hidden="true" />
          </Button>
        </div>
      )}
      <header className="topbar">
        <div>
          <p className="eyebrow">{yearPart}</p>
          <p className="current-date">
            {datePart} <span>{weekdayPart}</span>
          </p>
          {sync.lastSyncedLabel && (
            <p className="flow-sync">
              {sync.status === 'syncing' ? '同期中…' : `最終同期 ${sync.lastSyncedLabel}`}
            </p>
          )}
        </div>
        <div className="topbar-actions">
          <Button onClick={props.onOpenActivity}>
            履歴 {unreadActivity > 0 && <b>{unreadActivity}</b>}
          </Button>
          <Button onClick={props.onOpenSearch}>
            <Search aria-hidden="true" />
            検索
          </Button>
        </div>
      </header>

      <div className="today-summary">
        <span>{summary.join(' · ')}</span>
        {freshCount > 0 && <Button onClick={props.onJumpToFresh}>新しい予定 {freshCount}件</Button>}
      </div>

      <WeekStrip
        datePickerOpen={datePickerOpen}
        members={members}
        onJumpToDate={props.onJumpToDate}
        onNextWeek={props.onNextWeek}
        onPrevWeek={props.onPrevWeek}
        onToggleDatePicker={() => setDatePickerOpen((open) => !open)}
        selectedDate={selectedDate}
        week={week}
      />

      {/* biome-ignore lint/a11y/useSemanticElements: fieldset の既定の枠と flex の差を避けて見た目を変えない（role=group で同じ意味） */}
      <div
        aria-label="表示する人"
        className="member-filters"
        role="group"
        style={
          filters.length > 6
            ? {
                gridTemplateColumns: `repeat(${filters.length}, minmax(2.75rem, 1fr))`,
                overflowX: 'auto',
              }
            : undefined
        }
      >
        {filters.map((filter) => (
          <Button
            aria-pressed={pressed(filter.value)}
            key={filter.id}
            onClick={() => props.onSetFilter(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      <section className="schedule" aria-label="これからの予定" ref={scrollRef}>
        <div className="flow-sentinel" />
        {!hasAnyOccurrence(items) && emptyExamples.length > 0 ? (
          <div className="empty-state">
            <p className="empty-kicker">これから</p>
            <p className="empty-title">
              まだ予定は
              <br />
              ありません
            </p>
            <p className="empty-help">下の「予定を書く」から、話すように入力できます。</p>
            <div className="empty-examples">
              {emptyExamples.map((example) => (
                <Button key={example} onClick={() => props.onPickExample(example)}>
                  {example}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          items.map((item) => {
            if (item.kind === 'month') {
              return (
                <div className="month-divider" data-item-key={item.key} key={item.key}>
                  {item.label}
                </div>
              );
            }
            if (item.kind === 'gap') {
              return (
                <div className="timeline-row no-events-row" data-item-key={item.key} key={item.key}>
                  <ThreadRail members={members} />
                  <span>{item.label}</span>
                </div>
              );
            }
            const { day } = item;
            const continuing = day.ongoingMemberIds;
            const rows = [
              ...day.allDay.map((a) => ({ occ: a.occ, past: false })),
              ...day.timed.map((t) => ({ occ: t.occ, past: t.past })),
            ];
            const nowAt = day.nowIndex === null ? null : day.allDay.length + day.nowIndex;
            return (
              <div
                className="date-section"
                data-date={day.date}
                data-item-key={item.key}
                id={`date-${day.date}`}
                key={item.key}
              >
                <DayHeader
                  day={day}
                  members={members}
                  onAdd={() => props.onComposeOnDate(day.date)}
                />
                {rows.map((row, index) => (
                  <div className="flow-row" key={row.occ.key}>
                    {nowAt === index && <div className="now-line" role="presentation" />}
                    <ScheduleEventRow
                      continuingIds={continuing}
                      members={members}
                      occ={row.occ}
                      onOpen={() => props.onOpenOccurrence(row.occ.key)}
                      past={row.past}
                    />
                  </div>
                ))}
                {nowAt !== null && nowAt === rows.length && rows.length > 0 && (
                  <div className="now-line" role="presentation" />
                )}
                {rows.length === 0 && (
                  <div className="timeline-row no-events-row">
                    <ThreadRail continuingIds={continuing} members={members} />
                    <span>予定なし</span>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div className="flow-sentinel" />
      </section>

      {(showBackToToday || awayFromToday) && (
        <BottomSlot>
          <Button className="return-today" onClick={props.onJumpToday}>
            今日に戻る
          </Button>
        </BottomSlot>
      )}

      {datePickerOpen && (
        <DatePicker
          initialDate={selectedDate}
          onClose={() => setDatePickerOpen(false)}
          onSelectDate={(date) => {
            setDatePickerOpen(false);
            props.onJumpToDate(date);
          }}
          today={today}
          weekStart={weekStart}
        />
      )}
    </>
  );
}
