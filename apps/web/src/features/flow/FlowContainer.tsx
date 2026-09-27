import { addDays, type DateISO } from '@ito/core';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useEvents, useMe, useMeta } from '../../app/data-context';
import { useSyncVM } from '../../app/hooks';
import { useNav } from '../../app/nav';
import { useVmContext } from '../../app/use-vm';
import { useViewDate } from '../../app/view-date';
import { DEVICE_KEYS, readDevice, writeDevice } from '../../pwa/device';
import { isStandalone } from '../../pwa/install';
import UpcomingScreen from '../../ui/screens/UpcomingScreen';
import type { HomeNoticeVM } from '../../ui/types';
import { buildFlowScreen, FLOW_WINDOW_DAYS, shiftWeek } from '../../viewmodels/screens';

/** ホームの案内（F-23 のうちホーム画面への追加。通知の案内は Phase 4） */
export const INSTALL_NOTICE: HomeNoticeVM = {
  kind: 'install',
  message: 'ホーム画面に追加すると、アプリのようにすぐ開けます',
  actionLabel: '追加の方法',
};

/** 端で足す日数と、足せる範囲（今日から過去 1 年・未来 3 年） */
const EXTEND_DAYS = 28;
const PAST_LIMIT = -366;
const FUTURE_LIMIT = 366 * 3;

/** S-01 これから */
export function FlowContainer() {
  const ctx = useVmContext();
  const events = useEvents();
  const me = useMe();
  const unread = useMeta<number>('unreadActivity') ?? 0;
  const sync = useSyncVM();
  const nav = useNav();
  const navigate = useNavigate();
  const { setViewDate } = useViewDate();
  const [filter, setFilter] = useState<string[] | null>(null);
  // いま見ている日（null = 今日）。週の帯・日付で移動すると変わる
  const [selected, setSelected] = useState<DateISO | null>(null);
  const [range, setRange] = useState<{ from: DateISO; to: DateISO } | null>(null);
  const [notice, setNotice] = useState(
    () => !isStandalone() && readDevice(DEVICE_KEYS.installNoticeDismissed) !== '1',
  );
  const today = ctx?.today ?? null;
  const selectedDate = selected ?? today;
  const weekStart = me?.settings.weekStart ?? 0;

  // 入力バーから書く画面を開くと、いま見ている日を選んだ状態で開く（§16）
  useEffect(() => {
    setViewDate(selected);
    return () => setViewDate(null);
  }, [selected, setViewDate]);

  const from = range?.from ?? (today ? addDays(today, -1) : null);
  const to = range?.to ?? (today ? addDays(today, FLOW_WINDOW_DAYS) : null);

  const data = useMemo(() => {
    if (!ctx || !events || !selectedDate || !from || !to) return null;
    return buildFlowScreen({
      events,
      ctx,
      filter,
      from,
      to,
      selectedDate,
      weekStart,
      unreadActivity: unread,
      notice: notice ? INSTALL_NOTICE : null,
      showBackToToday: selectedDate !== ctx.today,
    });
    // sync は一覧の組み立てに使わない（60 秒ごとの同期で一覧を作り直さない）
  }, [ctx, events, filter, from, to, selectedDate, weekStart, unread, notice]);

  if (!data || !today || !selectedDate || !from || !to) {
    return <p className="detail-meta">読み込み中…（家のサーバーにつながると表示されます）</p>;
  }

  const clamp = (d: DateISO) => {
    const min = addDays(today, PAST_LIMIT);
    const max = addDays(today, FUTURE_LIMIT);
    return d < min ? min : d > max ? max : d;
  };

  const jumpTo = (date: DateISO) => {
    const target = clamp(date);
    const same = target === selectedDate;
    setSelected(target === today ? null : target);
    // 表示の範囲の外なら、その日の前後 8 週に置き換える（§19。今日から遠くても一度に何年分も作らない）
    if (target < from || target >= to) {
      setRange({
        from: addDays(target, -FLOW_WINDOW_DAYS),
        to: addDays(target, FLOW_WINDOW_DAYS),
      });
    }
    // 同じ日をもう一度選んだとき（スクロールで離れたあと）は、その日へ合わせ直す
    if (same) {
      requestAnimationFrame(() =>
        document.getElementById(`date-${target}`)?.scrollIntoView({ block: 'start' }),
      );
    }
  };

  return (
    <UpcomingScreen
      {...data}
      sync={sync}
      onComposeOnDate={(date) => nav.openComposer({ date })}
      onJumpToDate={jumpTo}
      onJumpToFresh={() =>
        document.querySelector('[data-fresh="true"]')?.scrollIntoView({ block: 'center' })
      }
      onJumpToday={() => {
        setSelected(null);
        setRange(null);
        requestAnimationFrame(() =>
          document.getElementById(`date-${today}`)?.scrollIntoView({ block: 'start' }),
        );
      }}
      onNextWeek={() => jumpTo(shiftWeek(selectedDate, 1))}
      onNoticeAction={() => navigate('/install')}
      onNoticeDismiss={() => {
        writeDevice(DEVICE_KEYS.installNoticeDismissed, '1');
        setNotice(false);
      }}
      onOpenActivity={() => navigate('/activity')}
      onOpenOccurrence={nav.openEvent}
      onOpenSearch={() => navigate('/search')}
      onPickExample={(text) => nav.openComposer({ text, date: selectedDate })}
      onPrevWeek={() => jumpTo(shiftWeek(selectedDate, -1))}
      onReachEnd={() => setRange({ from, to: clamp(addDays(to, EXTEND_DAYS)) })}
      onReachStart={() => setRange({ from: clamp(addDays(from, -EXTEND_DAYS)), to })}
      onSetFilter={setFilter}
    />
  );
}
