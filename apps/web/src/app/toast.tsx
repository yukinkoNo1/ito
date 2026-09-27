import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useData } from './data-context';

export interface ToastItem {
  id: number;
  kind: 'info' | 'error' | 'undo';
  message: string;
  actionLabel: string | null;
  onAction?: () => void;
}

interface ToastApi {
  show: (t: Omit<ToastItem, 'id'>) => void;
  current: ToastItem | null;
  dismiss: () => void;
  act: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** トースト（C-03）。「元に戻す」は 5 秒出す（§6.1） */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastItem | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { store } = useData();

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCurrent(null);
  }, []);

  const show = useCallback((t: Omit<ToastItem, 'id'>) => {
    if (timer.current) clearTimeout(timer.current);
    seq.current++;
    setCurrent({ ...t, id: seq.current });
    timer.current = setTimeout(() => setCurrent(null), 5000);
  }, []);

  const act = useCallback(() => {
    current?.onAction?.();
    dismiss();
  }, [current, dismiss]);

  useEffect(
    () => store.onToast((t) => show({ kind: t.kind, message: t.message, actionLabel: null })),
    [store, show],
  );

  return (
    <ToastContext.Provider value={{ show, current, dismiss, act }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext);
  if (!v) throw new Error('ToastProvider がありません');
  return v;
}
