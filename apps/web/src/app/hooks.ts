import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
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
