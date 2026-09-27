import { apiRequest } from '../data/api';
import type { DataStore } from '../data/store';
import type { ToastItem } from './toast';

type ShowToast = (t: Omit<ToastItem, 'id'>) => void;

function problemTitle(body: unknown): string | null {
  return typeof body === 'object' && body !== null && 'title' in body
    ? String((body as { title: unknown }).title)
    : null;
}

/**
 * オンラインでだけできる操作（自分の設定・家族の管理。§12 の送信待ちには入れない）。
 * 失敗は理由をトーストに出して false を返す。成功したら同期して手元に反映する
 */
export async function sendOnline(
  store: DataStore,
  showToast: ShowToast,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await apiRequest(method, path, { body });
    if (res.status >= 400) {
      showToast({
        kind: 'error',
        message: problemTitle(res.body) ?? '保存できませんでした',
        actionLabel: null,
      });
      return false;
    }
    await store.syncNow();
    return true;
  } catch {
    showToast({ kind: 'error', message: '家のサーバーにつながりません', actionLabel: null });
    return false;
  }
}
