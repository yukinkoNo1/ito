import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { DEVICE_KEYS, readDevice, writeDevice } from '../pwa/device';
import { useData } from './data-context';

const FreshContext = createContext<number | null>(null);

function readBaseline(): number | null {
  const v = Number(readDevice(DEVICE_KEYS.lastOpenedAt));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * 新着の印の基準（F-21・§12）。開いたとき（前面に来たとき）に、保存済みの「前回開いた時刻」を今回の基準にする。
 * 背面に回るとき・ページを離れるときに今の時刻を保存する（同じ回のあいだは印が消えない）。
 * はじめての端末は基準なし（印を付けない）。
 */
export function FreshProvider({ children }: { children: ReactNode }) {
  const { clock } = useData();
  const [baseline, setBaseline] = useState<number | null>(() => readBaseline());
  useEffect(() => {
    const save = () => writeDevice(DEVICE_KEYS.lastOpenedAt, String(clock.now()));
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
      else setBaseline(readBaseline());
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', save);
    // はじめての端末は、いまを「前回開いた時刻」にしておく（次に開いたとき、そのあとの変更に印が付く）
    if (readBaseline() === null) save();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', save);
    };
  }, [clock]);
  return <FreshContext.Provider value={baseline}>{children}</FreshContext.Provider>;
}

export function useFreshSince(): number | null {
  return useContext(FreshContext);
}
