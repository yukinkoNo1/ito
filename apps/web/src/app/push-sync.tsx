import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { checkPushSubscription, listenServiceWorkerMessages, syncAppBadge } from '../pwa/push';
import { useData, useMeta } from './data-context';

/**
 * 通知まわりの常駐の処理（§15）:
 * - 起動・前面復帰のたびに購読を確かめる（iOS は黙って失効する）
 * - SW からの知らせ（push を受けたら同期、通知を押したらその場所へ）
 * - アプリのバッジを未読の履歴の数に合わせる
 */
export function PushSync() {
  const { store } = useData();
  const navigate = useNavigate();
  const unread = useMeta<number>('unreadActivity');

  useEffect(() => {
    void checkPushSubscription();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkPushSubscription();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(
    () =>
      listenServiceWorkerMessages({
        onSync: () => void store.syncNow({ retryNow: true }),
        onNavigate: (path) => navigate(path),
      }),
    [store, navigate],
  );

  useEffect(() => {
    if (unread !== undefined) syncAppBadge(unread);
  }, [unread]);

  return null;
}
