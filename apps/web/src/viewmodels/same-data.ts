/** 中身の同じデータを同じオブジェクトのまま使う（描き直しと組み立て直しを省く。§19。§24 D40） */

/** 素のデータ（VM）の中身が同じか（関数を含まない配列・オブジェクト・プリミティブ） */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameData(v, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return ka.every((k) => Object.hasOwn(rb, k) && sameData(ra[k], rb[k]));
}

/**
 * 作り直した一覧のうち、中身が前と同じ行は前のオブジェクトを使う（範囲を足したとき、変わらない日を
 * 描き直さない。UpcomingScreen は行を memo で描く。§19。§24 D40）
 */
export function reuseSame<T extends { key: string }>(prev: readonly T[] | null, next: T[]): T[] {
  if (!prev || prev.length === 0) return next;
  const byKey = new Map(prev.map((item) => [item.key, item]));
  return next.map((item) => {
    const old = byKey.get(item.key);
    return old !== undefined && sameData(old, item) ? old : item;
  });
}

/**
 * 中身が前と同じなら前のものを返す（同期で同じ中身を書き直しても、別のオブジェクトにしない。
 * 画面の useMemo が組み立て直さないように。総点検のレビュー 2 回目 D8）
 */
export function keepSame<T>(prev: T | null, next: T): T {
  return prev !== null && sameData(prev, next) ? prev : next;
}

/**
 * 家族の一覧を作った順（同じなら ID 順）に並べる。中身が前と同じなら前の配列を返す（同期で同じ中身を書き直しても、
 * 画面の文脈を作り直さない。useMembers はこれだけを呼ぶ。総点検のレビュー 2 回目 D8・3 回目 E4）
 */
export function sortMembersKeepingSame<T extends { createdAt: string; id: string }>(
  prev: T[] | null,
  rows: readonly T[],
): T[] {
  const sorted = [...rows].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1,
  );
  return keepSame(prev, sorted);
}
