import { type ActivityDTO, activityPageSchema } from '@ito/core';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useData, useMembers, useNow } from '../../app/data-context';
import { apiRequest } from '../../data/api';
import { buildActivity } from '../../viewmodels/detail';

const ACTION_LABEL = { create: '追加', update: '変更', delete: '削除', restore: '復元' } as const;

/** S-08 履歴（開くと既読。素朴な HTML。Phase 6 で本番の UI に差し替える） */
export function ActivityPage() {
  const { db, store } = useData();
  const members = useMembers();
  const now = useNow();
  const navigate = useNavigate();
  const [items, setItems] = useState<ActivityDTO[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = async (before: string | null) => {
    try {
      const res = await apiRequest(
        'GET',
        `/api/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      );
      const parsed = activityPageSchema.safeParse(res.body);
      if (res.status !== 200 || !parsed.success) {
        setFailed(true);
        return;
      }
      setItems((prev) => [...(before ? (prev ?? []) : []), ...parsed.data.items]);
      setNext(parsed.data.nextBefore);
    } catch {
      setFailed(true);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いたときに 1 回だけ読み、既読にする
  useEffect(() => {
    void (async () => {
      await load(null);
      try {
        await apiRequest('POST', '/api/activity/read', { body: {} });
        await db.setMeta('unreadActivity', 0);
        void store.syncNow();
      } catch {}
    })();
  }, []);

  if (failed && !items) return <p>履歴はオンラインで見られます（家のサーバーにつながりません）</p>;
  if (!items) return <p>読み込み中…</p>;
  const vms = buildActivity(items, now);
  return (
    <div>
      <h1 className="text-xl">履歴</h1>
      <ul>
        {vms.map((a) => (
          <li key={a.id} className="border-b py-2">
            <button
              type="button"
              className="min-h-11 w-full text-left"
              onClick={() => navigate(`/e/${a.eventId}`)}
            >
              {a.unread ? '● ' : ''}
              {a.dayLabel} {a.atLabel} {members.find((m) => m.id === a.actorId)?.name ?? '？'} が「
              {a.title}」を{ACTION_LABEL[a.action]}
              {a.detail ? `（${a.detail}）` : ''}
            </button>
          </li>
        ))}
      </ul>
      {next && (
        <button type="button" className="min-h-11 px-3" onClick={() => void load(next)}>
          もっと見る
        </button>
      )}
    </div>
  );
}
