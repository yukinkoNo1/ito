import { type ActivityDTO, activityPageSchema } from '@ito/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useData, useNow } from '../../app/data-context';
import { useMemberVMs } from '../../app/hooks';
import { goBack, useNav } from '../../app/nav';
import { useToast } from '../../app/toast';
import { apiRequest } from '../../data/api';
import HistoryScreen from '../../ui/screens/HistoryScreen';
import { buildActivity } from '../../viewmodels/detail';

/** S-08 履歴（オンラインで。開くと既読） */
export function ActivityContainer() {
  const { db, store } = useData();
  const members = useMemberVMs();
  const now = useNow();
  const nav = useNav();
  const navigate = useNavigate();
  const toast = useToast();
  const showToast = toast.show;
  const [items, setItems] = useState<ActivityDTO[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'offline' | 'ready'>('loading');
  // 続きを読んでいるあいだは、もう一度読まない（同じページを 2 回足さない）
  const loading = useRef(false);

  const load = useCallback(
    async (before: string | null) => {
      if (loading.current) return false;
      loading.current = true;
      try {
        const res = await apiRequest(
          'GET',
          `/api/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`,
        );
        const parsed = activityPageSchema.safeParse(res.body);
        if (res.status !== 200 || !parsed.success) throw new Error('activity');
        setItems((prev) => [...(before ? prev : []), ...parsed.data.items]);
        setNext(parsed.data.nextBefore);
        setStatus('ready');
        return true;
      } catch {
        if (!before) setStatus('offline');
        showToast({
          kind: 'error',
          message: '履歴はオンラインで見られます（家のサーバーにつながりません）',
          actionLabel: null,
        });
        return false;
      } finally {
        loading.current = false;
      }
    },
    [showToast],
  );

  // 開いたときに読み、既読にする（§6.3 S-08）
  useEffect(() => {
    void (async () => {
      if (!(await load(null))) return;
      try {
        await apiRequest('POST', '/api/activity/read', { body: {} });
        await db.setMeta('unreadActivity', 0);
        void store.syncNow();
      } catch {}
    })();
  }, [load, db, store]);

  return (
    <HistoryScreen
      hasMore={next !== null}
      items={buildActivity(items, now)}
      status={status}
      members={members}
      onBack={() => goBack(navigate, '/')}
      onLoadMore={() => {
        if (next) void load(next);
      }}
      onOpenEvent={(eventId) => nav.openEvent(eventId)}
    />
  );
}
