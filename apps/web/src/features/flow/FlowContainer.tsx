import { addDays, type DateISO } from '@ito/core';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useEvents, useMe, useMeta } from '../../app/data-context';
import { useSyncVM } from '../../app/hooks';
import { useNav } from '../../app/nav';
import { useToast } from '../../app/toast';
import { useVmContext } from '../../app/use-vm';
import { useViewDate } from '../../app/view-date';
import { DEVICE_KEYS, writeDevice } from '../../pwa/device';
import {
  homeNoticeKind,
  INSTALL_NOTICE,
  NOTIFICATIONS_NOTICE,
  type NoticeKind,
} from '../../pwa/home-notice';
import {
  ENABLE_MESSAGES,
  enablePush,
  loadPublicKey,
  type PublicKeyState,
  UNKNOWN_KEY,
} from '../../pwa/push';
import UpcomingScreen from '../../ui/screens/UpcomingScreen';
import {
  buildFlowScreen,
  extendFlowRange,
  FLOW_FUTURE_LIMIT,
  FLOW_PAST_LIMIT,
  FLOW_WINDOW_DAYS,
  shiftWeek,
} from '../../viewmodels/screens';

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
  // 範囲を置き換えたあとに合わせる行（描き直したあとでないと要素がない）
  const [pendingScroll, setPendingScroll] = useState<'fresh' | DateISO | null>(null);
  const [notice, setNotice] = useState<NoticeKind | null>(homeNoticeKind);
  const [publicKey, setPublicKey] = useState<PublicKeyState>(UNKNOWN_KEY);
  const toast = useToast();

  // 通知の案内を出すときは公開鍵を先に取っておく（ボタンを押したあと最初に待つのは許可のダイアログ。§15）
  useEffect(() => {
    if (notice !== 'notifications') return;
    let cancelled = false;
    void loadPublicKey().then((key) => {
      if (!cancelled) setPublicKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, [notice]);
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
      notice:
        notice === 'install'
          ? INSTALL_NOTICE
          : notice === 'notifications'
            ? NOTIFICATIONS_NOTICE
            : null,
      // 今日から離れた（移動した・今日の日が描く範囲から外れた）ら「今日に戻る」
      showBackToToday: selectedDate !== ctx.today || ctx.today < from || ctx.today >= to,
    });
    // sync は一覧の組み立てに使わない（60 秒ごとの同期で一覧を作り直さない）
  }, [ctx, events, filter, from, to, selectedDate, weekStart, unread, notice]);

  // 範囲を置き換えて描き直したあとで、その行へ合わせる
  useEffect(() => {
    if (!pendingScroll || !data) return;
    const el =
      pendingScroll === 'fresh'
        ? document.querySelector('[data-fresh="true"]')
        : document.getElementById(`date-${pendingScroll}`);
    el?.scrollIntoView({ block: pendingScroll === 'fresh' ? 'center' : 'start' });
    setPendingScroll(null);
  }, [pendingScroll, data]);

  if (!data || !today || !selectedDate || !from || !to) {
    return <p className="detail-meta">読み込み中…（家のサーバーにつながると表示されます）</p>;
  }

  const clamp = (d: DateISO) => {
    const min = addDays(today, FLOW_PAST_LIMIT);
    const max = addDays(today, FLOW_FUTURE_LIMIT);
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
      onJumpToFresh={() => {
        const el = document.querySelector('[data-fresh="true"]');
        if (el) {
          el.scrollIntoView({ block: 'center' });
          return;
        }
        // 描く範囲から外れていたら、今日のまわりに戻してから
        setSelected(null);
        setRange(null);
        setPendingScroll('fresh');
      }}
      onJumpToday={() => {
        setSelected(null);
        setRange(null);
        setPendingScroll(today);
      }}
      onNextWeek={() => jumpTo(shiftWeek(selectedDate, 1))}
      onNoticeAction={() => {
        if (notice !== 'notifications') {
          navigate('/install');
          return;
        }
        // 最初に待つのは requestPermission（enablePush の中）
        void enablePush(publicKey).then((result) => {
          // 許可しなかったときは案内が消えるだけ（設定で理由を出す）
          if (result !== 'denied') {
            toast.show({
              kind: result === 'enabled' ? 'info' : 'error',
              message: ENABLE_MESSAGES[result],
              actionLabel: null,
            });
          }
          // 許可を選んだら（許可しなかったときも）案内は消える
          setNotice(homeNoticeKind());
        });
      }}
      onNoticeDismiss={() => {
        writeDevice(
          notice === 'notifications'
            ? DEVICE_KEYS.notificationsNoticeDismissed
            : DEVICE_KEYS.installNoticeDismissed,
          '1',
        );
        setNotice(null);
      }}
      onOpenActivity={() => navigate('/activity')}
      onOpenOccurrence={nav.openEvent}
      onOpenSearch={() => navigate('/search')}
      onPickExample={(text) => nav.openComposer({ text, date: selectedDate })}
      onPrevWeek={() => jumpTo(shiftWeek(selectedDate, -1))}
      onReachEnd={(byScroll) =>
        setRange(extendFlowRange({ from, to }, 'end', byScroll === true, today))
      }
      onReachStart={(byScroll) =>
        setRange(extendFlowRange({ from, to }, 'start', byScroll === true, today))
      }
      onSetFilter={setFilter}
    />
  );
}
