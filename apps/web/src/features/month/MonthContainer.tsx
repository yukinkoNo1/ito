import { addMonths, type DateISO, firstOfMonth, isValidDate, monthKey, parseDate } from '@ito/core';
import { useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useEvents, useMe } from '../../app/data-context';
import { useNav } from '../../app/nav';
import { useVmContext } from '../../app/use-vm';
import { useViewDate } from '../../app/view-date';
import MonthScreen from '../../ui/screens/MonthScreen';
import { buildMonthScreen } from '../../viewmodels/screens';

/** S-02 月＋S-03 選んだ日の予定（`/month/:yyyy-mm`。選んだ日は `?d=` に置く＝詳細から戻っても同じ日） */
export function MonthContainer() {
  const ctx = useVmContext();
  const events = useEvents();
  const me = useMe();
  const nav = useNav();
  const navigate = useNavigate();
  const { ym } = useParams();
  const [params, setParams] = useSearchParams();
  const { setViewDate } = useViewDate();
  const today = ctx?.today ?? null;
  const shown =
    ym && /^\d{4}-\d{2}$/.test(ym) && isValidDate(`${ym}-01`) ? ym : (today?.slice(0, 7) ?? null);
  const d = params.get('d');
  const selectedDate: DateISO | null = !shown
    ? null
    : d && isValidDate(d) && d.startsWith(shown)
      ? d
      : today?.startsWith(shown)
        ? today
        : `${shown}-01`;
  const weekStart = me?.settings.weekStart ?? 0;

  // 入力バーから書く画面を開くと、選んだ日を選んだ状態で開く（§16）
  useEffect(() => {
    setViewDate(selectedDate);
    return () => setViewDate(null);
  }, [selectedDate, setViewDate]);

  const data = useMemo(() => {
    if (!ctx || !events || !shown || !selectedDate) return null;
    const { year, month } = parseDate(`${shown}-01`);
    return buildMonthScreen({ events, ctx, year, month, selectedDate, weekStart });
  }, [ctx, events, shown, selectedDate, weekStart]);

  if (!data || !today || !shown) {
    return <p className="detail-meta">読み込み中…（家のサーバーにつながると表示されます）</p>;
  }

  const goMonth = (year: number, month: number, day?: DateISO) =>
    navigate(`/month/${monthKey(year, month)}${day ? `?d=${day}` : ''}`);
  const shift = (delta: number) => {
    const { year, month } = parseDate(
      addMonths(firstOfMonth(data.month.year, data.month.month), delta),
    );
    goMonth(year, month);
  };

  return (
    <MonthScreen
      {...data}
      onComposeOnDate={(date) => nav.openComposer({ date })}
      onNextMonth={() => shift(1)}
      onOpenOccurrence={nav.openEvent}
      onPickMonth={(year, month) => goMonth(year, month)}
      onPrevMonth={() => shift(-1)}
      onSelectDate={(date) => {
        // 前後の月のセルを選んだら、その月へ移る
        if (!date.startsWith(shown)) {
          const { year, month } = parseDate(date);
          goMonth(year, month, date);
          return;
        }
        const next = new URLSearchParams(params);
        next.set('d', date);
        setParams(next, { replace: true });
      }}
      onToday={() => {
        const { year, month } = parseDate(today);
        goMonth(year, month, today);
      }}
    />
  );
}
