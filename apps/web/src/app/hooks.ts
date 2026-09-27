import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import type { MemberVM, SyncVM } from '../ui/types';
import { toMemberVMs } from '../viewmodels/occurrence';
import { toSyncVM } from '../viewmodels/screens';
import { useData, useMe, useMembers, useSyncState } from './data-context';

/** 送信待ちの件数（C-02） */
export function usePendingCount(): number {
  const { db } = useData();
  return useLiveQuery(() => db.outbox.count(), [db]) ?? 0;
}

/** 同期の状態（§22 SyncVM） */
export function useSyncVM(): SyncVM {
  const sync = useSyncState();
  const pending = usePendingCount();
  return useMemo(
    () => toSyncVM(sync.status, sync.lastSyncedAt, pending, sync.block),
    [sync, pending],
  );
}

/** 有効な家族（作成順。自分に isMe） */
export function useMemberVMs(): MemberVM[] {
  const me = useMe();
  const members = useMembers();
  return useMemo(() => (me ? toMemberVMs(members, me.id) : []), [members, me]);
}

/**
 * つながっていないか（C-04 の「これ以降」「すべて」を止めるため）。同期が通信エラーで止まっているか、
 * 端末がオフラインだと知らせているとき（同期そのものは navigator.onLine を見ない。§12）
 */
export function useOffline(): boolean {
  const sync = useSyncState();
  const [browserOffline, setBrowserOffline] = useState(
    () => globalThis.navigator?.onLine === false,
  );
  useEffect(() => {
    const update = () => setBrowserOffline(globalThis.navigator?.onLine === false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return sync.status === 'offline' || browserOffline;
}
