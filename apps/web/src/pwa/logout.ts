import type { ItoDb } from '../data/db';
import { clearDevice } from './device';

/**
 * この端末からログアウト（§17）: Push の購読を解除 → IndexedDB・Cache Storage を削除 → はじめて（S-11）へ。
 * Push の購読の解除（サーバーの購読の削除を含む）は Phase 4 でつなぐ。
 */
export async function logoutThisDevice(
  db: ItoDb,
  unsubscribePush: () => Promise<void> = async () => {},
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
  clearDevice();
}
