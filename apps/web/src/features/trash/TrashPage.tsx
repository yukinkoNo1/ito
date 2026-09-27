import { type TrashItemDTO, trashItemDtoSchema } from '@ito/core';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { useData, useMembers, useNow } from '../../app/data-context';
import { useToast } from '../../app/toast';
import { apiRequest } from '../../data/api';
import { buildTrash } from '../../viewmodels/detail';

const trashResponse = z.object({ items: z.array(trashItemDtoSchema) });

/** S-09 ゴミ箱（オンラインで。素朴な HTML。Phase 6 で本番の UI に差し替える） */
export function TrashPage() {
  const { store } = useData();
  const members = useMembers();
  const now = useNow();
  const toast = useToast();
  const [items, setItems] = useState<TrashItemDTO[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/trash');
      const parsed = trashResponse.safeParse(res.body);
      if (res.status === 200 && parsed.success) setItems(parsed.data.items);
      else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed && !items)
    return <p>ゴミ箱はオンラインで見られます（家のサーバーにつながりません）</p>;
  if (!items) return <p>読み込み中…</p>;
  const vms = buildTrash(items, members, now);
  return (
    <div>
      <h1 className="text-xl">ゴミ箱</h1>
      {vms.length === 0 && <p>ゴミ箱は空です</p>}
      <ul>
        {vms.map((t) => (
          <li key={t.eventId} className="border-b py-2">
            <p>
              {t.title}（{t.whenLabel}）
            </p>
            <p className="text-sm">
              {t.deletedByName} が {t.deletedLabel}・あと{t.daysLeft}日
            </p>
            <button
              type="button"
              className="min-h-11 px-3"
              onClick={() =>
                void store.restoreEvent(t.eventId).then((ok) => {
                  toast.show({
                    kind: ok ? 'info' : 'error',
                    message: ok ? '元に戻しました' : '戻せませんでした',
                    actionLabel: null,
                  });
                  void load();
                })
              }
            >
              元に戻す
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
