import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItoDb } from '../src/data/db';
import { logoutThisDevice } from '../src/pwa/logout';

describe('この端末からログアウト（§17）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Push の購読を解除 → IndexedDB・Cache Storage・端末の保存を消す', async () => {
    const store = new Map<string, string>([
      ['ito.onboarded', '1'],
      ['ito.lastOpenedAt', '123'],
      ['other', 'keep'],
    ]);
    vi.stubGlobal('localStorage', {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: async () => ['workbox-precache-v2', 'other'],
      delete: async (k: string) => {
        deleted.push(k);
        return true;
      },
    });
    const db = new ItoDb('logout-test');
    await db.setMeta('cursor', 5);
    const order: string[] = [];
    await logoutThisDevice(db, async () => {
      order.push('push');
    });
    expect(order).toEqual(['push']);
    expect(deleted).toEqual(['workbox-precache-v2', 'other']);
    expect([...store.keys()]).toEqual(['other']);
    const names = await indexedDB.databases();
    expect(names.map((d) => d.name)).not.toContain('logout-test');
  });
});
