import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useData, useSyncState } from '../../app/data-context';
import { useSyncVM } from '../../app/hooks';
import { useNav } from '../../app/nav';
import { useToast } from '../../app/toast';
import { useUpdate } from '../../app/update';
import { useViewDate } from '../../app/view-date';
import { checkForUpdate } from '../../pwa/register';
import AppShell from '../../ui/primitives/AppShell';
import type { TabId, ToastVM } from '../../ui/types';
import { COMPOSER_HINT } from '../../viewmodels/screens';
import { ComposerContainer } from '../composer/ComposerContainer';
import { EventDetailContainer } from '../event/EventDetailContainer';

const TAB_PATH: Record<TabId, string> = {
  flow: '/',
  month: '/month',
  free: '/free',
  settings: '/settings',
};

export function tabOf(pathname: string): TabId {
  if (pathname.startsWith('/month')) return 'month';
  if (pathname.startsWith('/free')) return 'free';
  if (pathname.startsWith('/settings') || pathname.startsWith('/trash')) return 'settings';
  return 'flow';
}

/** C-01 AppShell（C-02・C-03）と、上に重ねる S-04 詳細・S-05 書く画面 */
export function ShellLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { store } = useData();
  const syncState = useSyncState();
  const sync = useSyncVM();
  const toast = useToast();
  const applyUpdate = useUpdate();
  const nav = useNav();
  const { viewDate } = useViewDate();
  const outdated = syncState.block?.kind === 'client_outdated';

  // 426 client_outdated: 新しい SW を確かめる（待機中の SW ができれば「更新」が出る。§12）
  useEffect(() => {
    if (outdated) void checkForUpdate();
  }, [outdated]);

  const current = tabOf(location.pathname);
  // 新しい SW が待っていれば「更新」を出す（ほかのトーストがあればそちらが先。§17）
  const toastVm: ToastVM | null = toast.current
    ? {
        id: String(toast.current.id),
        kind: toast.current.kind,
        message: toast.current.message,
        actionLabel: toast.current.actionLabel,
      }
    : applyUpdate
      ? { id: 'update', kind: 'info', message: '新しいバージョンがあります', actionLabel: '更新' }
      : null;

  return (
    <AppShell
      composerHint={COMPOSER_HINT}
      current={current}
      onNavigate={(tab) => navigate(TAB_PATH[tab])}
      onOpenComposer={() => nav.openComposer(viewDate ? { date: viewDate } : {})}
      onRetrySync={() => {
        if (!outdated) {
          void store.syncNow({ retryNow: true });
          return;
        }
        if (applyUpdate) applyUpdate();
        else window.location.reload();
      }}
      onToastAction={() => {
        if (toast.current) toast.act();
        else applyUpdate?.();
      }}
      onToastDismiss={toast.dismiss}
      overlay={
        nav.detail || nav.composer ? (
          <>
            {/* 書く画面は詳細の上に重ねる（詳細の「編集」「複製」から開く）ので、あとに置く */}
            <EventDetailContainer />
            <ComposerContainer />
          </>
        ) : null
      }
      screen={current === 'month' ? 'month-screen' : undefined}
      sync={sync}
      toast={toastVm}
    >
      <Outlet />
    </AppShell>
  );
}
