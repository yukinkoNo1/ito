import type { DateISO } from '@ito/core';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

/**
 * いま見ている日（これからの週の帯・月で選んだ日）。入力バーから書く画面を開くと、この日を選んだ状態で開く
 * （§16 の書く画面の決まり。最初は今日＝null）
 */
interface ViewDateApi {
  viewDate: DateISO | null;
  setViewDate: (date: DateISO | null) => void;
}

const ViewDateContext = createContext<ViewDateApi | null>(null);

export function ViewDateProvider({ children }: { children: ReactNode }) {
  const [viewDate, setViewDate] = useState<DateISO | null>(null);
  const value = useMemo(() => ({ viewDate, setViewDate }), [viewDate]);
  return <ViewDateContext.Provider value={value}>{children}</ViewDateContext.Provider>;
}

export function useViewDate(): ViewDateApi {
  const v = useContext(ViewDateContext);
  if (!v) throw new Error('ViewDateProvider がありません');
  return v;
}
