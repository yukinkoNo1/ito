import { addDays, addMonths, firstOfMonth, monthKey, parseDate, WEEKDAY_LABELS } from '@ito/core';
import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useEvents, useMe, useVmContext } from '../../app/data-context';
import { buildDay, groupByDay } from '../../viewmodels/flow';
import { buildMonth } from '../../viewmodels/month';
import { toMemberVMs } from '../../viewmodels/occurrence';
import { DayBlock } from '../common/DayList';

/** 同じ中身が並んでも React の key がぶつからないように、2 つ目から #n を付ける */
function withKeys<T>(items: T[], keyOf: (item: T) => string): { item: T; key: string }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = keyOf(item);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { item, key: n === 1 ? base : `${base}#${n}` };
  });
}

/** S-02 月＋S-03 選んだ日の予定（素朴な HTML。Phase 6 で本番の UI に差し替える） */
export function MonthPage() {
  const ctx = useVmContext();
  const events = useEvents();
  const me = useMe();
  const { ym } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = ctx?.today ?? '2026-01-01';
  const ymValid = ym && /^\d{4}-\d{2}$/.test(ym) ? ym : today.slice(0, 7);
  const { year, month } = parseDate(`${ymValid}-01`);
  // 選んだ日は URL（?d=）に置く（詳細から戻ったときに同じ日を出す）
  const selected = params.get('d');
  const setSelected = (d: string) => {
    const next = new URLSearchParams(params);
    next.set('d', d);
    setParams(next, { replace: true });
  };
  const selectedDate = selected?.startsWith(ymValid)
    ? selected
    : ymValid === today.slice(0, 7)
      ? today
      : `${ymValid}-01`;
  const weekStart = me?.settings.weekStart ?? 0;

  const view = useMemo(() => {
    if (!ctx || !events) return null;
    const monthVm = buildMonth(events, year, month, weekStart, ctx);
    const day = buildDay(
      selectedDate,
      groupByDay(events, selectedDate, addDays(selectedDate, 1), ctx, null).get(selectedDate),
      ctx,
    );
    return { monthVm, day };
  }, [ctx, events, year, month, weekStart, selectedDate]);

  if (!ctx || !view) return <p>読み込み中…</p>;
  const members = toMemberVMs(ctx.members, ctx.meId);
  const go = (delta: number) => {
    const d = addMonths(firstOfMonth(year, month), delta);
    const p = parseDate(d);
    navigate(`/month/${monthKey(p.year, p.month)}`);
  };
  const openKey = (key: string) => {
    const [eventId, rid] = key.split('@');
    navigate(`/e/${eventId}${rid ? `?r=${encodeURIComponent(rid)}` : ''}`);
  };
  const compose = (date: string) => {
    const next = new URLSearchParams(params);
    next.set('compose', '1');
    next.set('date', date);
    setParams(next);
  };

  return (
    <div>
      <header className="flex items-center justify-between">
        <button
          type="button"
          aria-label="前の月"
          className="min-h-11 min-w-11"
          onClick={() => go(-1)}
        >
          ‹
        </button>
        <h1 className="text-xl">
          {view.monthVm.label}（{view.monthVm.wafu}）
        </h1>
        <button
          type="button"
          aria-label="次の月"
          className="min-h-11 min-w-11"
          onClick={() => go(1)}
        >
          ›
        </button>
      </header>
      <button
        type="button"
        className="min-h-11 px-3"
        onClick={() => navigate(`/month/${today.slice(0, 7)}?d=${today}`)}
      >
        今日
      </button>
      <table className="w-full table-fixed text-xs">
        <thead>
          <tr>
            {view.monthVm.weekdayLabels.map((w) => (
              <th key={w}>{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.monthVm.weeks.map((week) => (
            <tr key={week[0]?.date}>
              {week.map((c) => (
                <td key={c.date} className={`align-top ${c.inMonth ? '' : 'opacity-50'}`}>
                  <button
                    type="button"
                    className="min-h-11 w-full text-left"
                    aria-label={`${c.date}${c.holiday ? ` ${c.holiday}` : ''} ${c.count}件`}
                    aria-pressed={c.date === selectedDate}
                    onClick={() => setSelected(c.date)}
                  >
                    <span
                      className={
                        c.weekday === 0 || c.holiday
                          ? 'text-red-700'
                          : c.weekday === 6
                            ? 'text-blue-700'
                            : ''
                      }
                    >
                      {c.day}
                    </span>
                    {c.holiday && <span className="block truncate">{c.holiday}</span>}
                    {withKeys(c.items, (it) => `${it.title ?? ''}:${it.memberIds.join(',')}`).map(
                      ({ item, key }) => (
                        <span key={key} className="block truncate">
                          {item.title ?? '予定あり'}
                        </span>
                      ),
                    )}
                    {c.more > 0 && <span>+{c.more}</span>}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sr-only">週の始まり: {WEEKDAY_LABELS[weekStart]}曜日</p>
      <DayBlock day={view.day} members={members} onOpen={openKey} onCompose={compose} />
      <button type="button" className="min-h-11 px-3" onClick={() => compose(selectedDate)}>
        ＋ この日に書く
      </button>
    </div>
  );
}
