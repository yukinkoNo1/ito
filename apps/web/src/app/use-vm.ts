import { todayJst } from '@ito/core';
import { useMemo } from 'react';
import type { VmContext } from '../viewmodels/occurrence';
import { useMe, useMembers, useNow } from './data-context';
import { useFreshSince } from './fresh';

/**
 * viewmodels に渡す文脈（今・今日・自分・家族・新着の基準）。中身が変わったときだけ新しいオブジェクトにする
 * （画面の useMemo が、関係のない描き直し（同期の表示など）のたびに一覧を組み立て直さないように。§19。§24 D40）
 */
export function useVmContext(): VmContext | null {
  const me = useMe();
  const members = useMembers();
  const nowMs = useNow();
  const freshSince = useFreshSince();
  const meId = me?.id ?? null;
  return useMemo(
    () => (meId === null ? null : { nowMs, today: todayJst(nowMs), meId, members, freshSince }),
    [meId, nowMs, members, freshSince],
  );
}
