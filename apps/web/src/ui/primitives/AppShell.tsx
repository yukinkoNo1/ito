import { CalendarDays, CalendarRange, Clock3, Settings, Undo2, X } from 'lucide-react';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppShellProps, SyncVM, TabId } from '../types';
import { Button } from './Controls';

const NAV: { label: string; icon: typeof Clock3; tab: TabId }[] = [
  { label: 'これから', icon: Clock3, tab: 'flow' },
  { label: '月', icon: CalendarDays, tab: 'month' },
  { label: '空き', icon: CalendarRange, tab: 'free' },
  { label: '設定', icon: Settings, tab: 'settings' },
];

const BottomSlotContext = createContext<HTMLElement | null>(null);

/** 下の帯の上に出す行（「今日に戻る」）。画面の部品から AppShell の下の帯へ描く（§24 D29） */
export function BottomSlot({ children }: { children: ReactNode }) {
  const el = useContext(BottomSlotContext);
  return el ? createPortal(children, el) : null;
}

/** C-02: 未送信・オフラインは入力バーのすぐ上に 1 行 */
export function connectionText(sync: SyncVM): string | null {
  const pending = sync.pendingCount > 0 ? `未送信 ${sync.pendingCount}件` : null;
  if (sync.status === 'offline') {
    return ['家のサーバーにつながりません（Tailscale を確認）', pending]
      .filter(Boolean)
      .join(' · ');
  }
  if (sync.status === 'error') {
    return [sync.errorLabel ?? '同期できません', pending].filter(Boolean).join(' · ');
  }
  if (pending) return `${pending} · 接続時に送信します`;
  return null;
}

/** C-01 AppShell（下部に一言入力バーと、アイコン＋文字のナビ）・C-02・C-03 */
export default function AppShell({
  current,
  screen,
  sync,
  toast,
  composerHint,
  onNavigate,
  onOpenComposer,
  onRetrySync,
  onToastAction,
  onToastDismiss,
  children,
  overlay,
}: AppShellProps) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const connection = connectionText(sync);
  const canRetry = sync.status === 'offline' || sync.status === 'error';
  const modal = Boolean(overlay);
  const toastBar = toast && (
    <div className={`undo-bar undo-bar--${toast.kind}`} role="status">
      <span>{toast.message}</span>
      {toast.actionLabel ? (
        <Button onClick={onToastAction}>
          {toast.kind === 'undo' && <Undo2 aria-hidden="true" />}
          {toast.actionLabel}
        </Button>
      ) : (
        <Button aria-label="閉じる" onClick={onToastDismiss}>
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
  return (
    <main className={`app-shell ${screen ?? ''}`}>
      <BottomSlotContext.Provider value={slot}>
        <div className="app-shell-content" inert={modal}>
          {children}
        </div>
      </BottomSlotContext.Provider>
      <div className="bottom-area" inert={modal}>
        {!modal && toastBar}
        {connection && (
          <div
            className={`connection-state ${canRetry ? 'connection-state--action' : ''}`}
            role="status"
          >
            <span>{connection}</span>
            {canRetry && (
              <Button onClick={onRetrySync}>{sync.action === 'update' ? '更新' : '再試行'}</Button>
            )}
          </div>
        )}
        <div className="bottom-slot" ref={setSlot} />
        <Button className="quick-add-trigger" onClick={onOpenComposer}>
          <b>＋</b>
          <span>予定を書く</span>
          <small>{composerHint}</small>
        </Button>
        <nav className="bottom-nav" aria-label="メイン">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                aria-current={current === item.tab ? 'page' : undefined}
                key={item.tab}
                onClick={() => onNavigate(item.tab)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Button>
            );
          })}
        </nav>
      </div>
      {overlay}
      {/* シートを開いているあいだも「元に戻す」が見えるように、シートの上に出す（§6.1） */}
      {modal && toastBar && <div className="toast-layer">{toastBar}</div>}
    </main>
  );
}
