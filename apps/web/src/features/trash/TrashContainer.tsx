import { type TrashItemDTO, trashItemDtoSchema } from '@ito/core';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { useData, useMembers, useNow } from '../../app/data-context';
import { goBack } from '../../app/nav';
import { useToast } from '../../app/toast';
import { apiRequest } from '../../data/api';
import TrashScreen from '../../ui/screens/TrashScreen';
import { buildTrash } from '../../viewmodels/detail';

const trashResponse = z.object({ items: z.array(trashItemDtoSchema) });

/** S-09 ゴミ箱（オンラインで。復元） */
export function TrashContainer() {
  const { store } = useData();
  const members = useMembers();
  const now = useNow();
  const toast = useToast();
  const showToast = toast.show;
  const navigate = useNavigate();
  const [items, setItems] = useState<TrashItemDTO[]>([]);
  const [status, setStatus] = useState<'loading' | 'offline' | 'ready'>('loading');

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/trash');
      const parsed = trashResponse.safeParse(res.body);
      if (res.status !== 200 || !parsed.success) throw new Error('trash');
      setItems(parsed.data.items);
      setStatus('ready');
    } catch {
      setStatus((s) => (s === 'ready' ? s : 'offline'));
      showToast({
        kind: 'error',
        message: 'ゴミ箱はオンラインで見られます（家のサーバーにつながりません）',
        actionLabel: null,
      });
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <TrashScreen
      items={buildTrash(items, members, now)}
      onBack={() => goBack(navigate, '/settings')}
      status={status}
      onRestore={(eventId) =>
        void store.restoreEvent(eventId).then((result) => {
          showToast({
            kind: result.ok ? 'info' : 'error',
            message: result.ok
              ? '予定を元に戻しました'
              : result.reason
                ? `元に戻せませんでした（${result.reason}）`
                : '元に戻せませんでした',
            actionLabel: null,
          });
          void load();
        })
      }
    />
  );
}
