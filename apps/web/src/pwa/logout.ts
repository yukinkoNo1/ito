import type { ItoDb } from '../data/db';
import { clearDevice } from './device';
import { unsubscribePush as unsubscribeThisDevice } from './push';

/**
 * この端末からログアウト（§17）: Push の購読を解除（サーバーの購読も消す）→ IndexedDB・Cache Storage を削除 →
 * はじめて（S-11）へ。
 */
export async function logoutThisDevice(
  db: ItoDb,
  unsubscribePush: () => Promise<void> = () => unsubscribeThisDevice(),
): Promise<void> {
  try {
    await unsubscribePush();
  } catch {}
  db.close();
  try {
    await db.delete();
  } catch {}
  try {
    if ('caches' in globalThis) {
      for (const key of await caches.keys()) await caches.delete(key);
    }
  } catch {}
  // プリキャッシュを消したので SW の登録も外す（残すと、次の版が来るまでオフラインで開けない）
  try {
    const registrations = (await globalThis.navigator?.serviceWorker?.getRegistrations?.()) ?? [];
    for (const r of registrations) await r.unregister();
  } catch {}
  clearDevice();
}
