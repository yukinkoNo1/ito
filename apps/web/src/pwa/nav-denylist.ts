/**
 * Service Worker がキャッシュした index.html を返さないページ遷移（SPEC §17・§18 T3。総点検 A5）。
 * Workbox の NavigationRoute は pathname＋search に当てるので、クエリ付き・/api ちょうど・
 * パーセントエンコードした形（サーバーは %61pi を /api と読む）も除く。除いた遷移はサーバーへ行く
 */
export const NAV_DENYLIST: RegExp[] = [
  /^\/api(?:[/?]|$)/i,
  /^\/healthz(?:[/?]|$)/i,
  // パスにパーセントエンコードがあれば、サーバーがどう読むかに任せる
  /^[^?]*%/,
];

export function isDeniedNavigation(url: URL): boolean {
  const pathAndSearch = url.pathname + url.search;
  return NAV_DENYLIST.some((re) => re.test(pathAndSearch));
}
