import { type Clock, type MeDTO, type MemberDTO, systemClock } from '@ito/core';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { ItoDb, type LocalEvent } from '../data/db';
import { DataStore, type SyncState } from '../data/store';

interface DataContextValue {
  db: ItoDb;
  store: DataStore;
  clock: Clock;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({
  children,
  clock = systemClock,
}: {
  children: ReactNode;
  clock?: Clock;
}) {
  const value = useMemo(() => {
    const db = new ItoDb();
    return { db, store: new DataStore(db, clock), clock };
  }, [clock]);

  useEffect(() => {
    const { store } = value;
    void store.syncNow();
    // 表示中は 60 秒ごと、online イベント、前面に戻ったとき（§12）
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void store.syncNow();
    }, 60_000);
    const onOnline = () => void store.syncNow({ retryNow: true });
    const onVisible = () => {
      if (document.visibilityState === 'visible') void store.syncNow({ retryNow: true });
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [value]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const v = useContext(DataContext);
  if (!v) throw new Error('DataProvider がありません');
  return v;
}

export function useSyncState(): SyncState {
  const { store } = useData();
  return useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.getState(),
  );
}

export function useMe(): MeDTO | undefined {
  const { db } = useData();
  return useLiveQuery(() => db.getMeta<MeDTO>('me'), [db]);
}

export function useMembers(): MemberDTO[] {
  const { db } = useData();
  const members = useLiveQuery(() => db.members.toArray(), [db]);
  // 並べた配列は、家族の一覧が変わったときだけ作り直す（描き直しのたびに別の配列にしない。§24 D40）
  return useMemo(
    () =>
      [...(members ?? [])].sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1,
      ),
    [members],
  );
}

export function useEvents(): LocalEvent[] | undefined {
  const { db } = useData();
  return useLiveQuery(() => db.events.toArray(), [db]);
}

export function useMeta<T>(key: string): T | undefined {
  const { db } = useData();
  return useLiveQuery(() => db.getMeta<T>(key), [db, key]);
}

/** 今の時刻（1 分ごとに更新） */
export function useNow(): number {
  const { clock } = useData();
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const t = setInterval(() => setNow(clock.now()), 60_000);
    return () => clearInterval(t);
  }, [clock]);
  return now;
}
