import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { checkForUpdate } from '../pwa/register';
import { useData, useSyncState } from './data-context';
import { useToast } from './toast';
import { useUpdate } from './update';

/** 素朴な AppShell（Phase 6 で本番の UI に差し替える） */
export function Shell({ children }: { children: ReactNode }) {
  const sync = useSyncState();
  const { store, db } = useData();
  const toast = useToast();
  const applyUpdate = useUpdate();
  const pending = useLiveQuery(() => db.outbox.count(), [db]) ?? 0;
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const outdated = sync.block?.kind === 'client_outdated';

  // 426 client_outdated: 新しい SW を確かめる（待機中の SW ができれば「更新」が出る。§12）
  useEffect(() => {
    if (outdated) void checkForUpdate();
  }, [outdated]);

  const syncLine =
    sync.block?.kind === 'not_member'
      ? `このアカウント（${sync.block.login ?? ''}）は家族として登録されていません`
      : sync.block?.kind === 'no_identity'
        ? 'ログインが確認できません（Tailscale を確認）'
        : sync.block?.kind === 'client_outdated'
          ? 'アプリを更新してください'
          : sync.status === 'offline'
            ? '家のサーバーにつながりません（Tailscale を確認）'
            : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col">
      <main className="flex-1 p-3 pb-40">{children}</main>
      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-[480px] border-t bg-white p-2">
        {syncLine && (
          <p role="status" className="flex items-center justify-between gap-2 text-sm">
            <span>{syncLine}</span>
            {outdated ? (
              !applyUpdate && (
                <button
                  type="button"
                  className="min-h-11 px-3 font-bold"
                  onClick={() => window.location.reload()}
                >
                  更新
                </button>
              )
            ) : (
              <button
                type="button"
                className="min-h-11 px-3"
                onClick={() => void store.syncNow({ retryNow: true })}
              >
                再試行
              </button>
            )}
          </p>
        )}
        {pending > 0 && !syncLine && (
          <p role="status" className="text-sm">
            未送信 {pending}件
          </p>
        )}
        {applyUpdate && (
          <p role="status" className="flex items-center justify-between gap-2 text-sm">
            <span>新しいバージョンがあります</span>
            <button type="button" className="min-h-11 px-3 font-bold" onClick={applyUpdate}>
              更新
            </button>
          </p>
        )}
        {toast.current && (
          <p
            role="status"
            aria-live="polite"
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span>{toast.current.message}</span>
            {toast.current.actionLabel && (
              <button type="button" className="min-h-11 px-3 font-bold" onClick={toast.act}>
                {toast.current.actionLabel}
              </button>
            )}
          </p>
        )}
        <button
          type="button"
          className="mb-2 min-h-12 w-full rounded border px-3 text-left text-base"
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set('compose', '1');
            setParams(next);
          }}
        >
          予定を書く
        </button>
        <nav aria-label="画面の切り替え" className="grid grid-cols-4 text-center text-sm">
          <Link
            className="min-h-11 py-2"
            aria-current={location.pathname === '/' ? 'page' : undefined}
            to="/"
          >
            これから
          </Link>
          <Link className="min-h-11 py-2" to="/month">
            月
          </Link>
          <Link className="min-h-11 py-2" to="/free">
            空き
          </Link>
          <Link className="min-h-11 py-2" to="/settings">
            設定
          </Link>
        </nav>
      </div>
    </div>
  );
}
