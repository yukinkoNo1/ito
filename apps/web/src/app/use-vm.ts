import { todayJst } from '@ito/core';
import type { VmContext } from '../viewmodels/occurrence';
import { useMe, useMembers, useNow } from './data-context';
import { useFreshSince } from './fresh';

/** viewmodels に渡す文脈（今・今日・自分・家族・新着の基準） */
export function useVmContext(): VmContext | null {
  const me = useMe();
  const members = useMembers();
  const nowMs = useNow();
  const freshSince = useFreshSince();
  if (!me) return null;
  return { nowMs, today: todayJst(nowMs), meId: me.id, members, freshSince };
}
