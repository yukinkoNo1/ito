import { apiFile, type Fetcher, NetworkError } from '../data/api';
import { detectPlatform } from './install';

/**
 * 書き出し（§5 F-20・§13・§17）: fetch で取って Blob にし、ファイルとして保存する（ページ遷移で開かない）。
 * iPhone は navigator.share({ files }) が使えればそれで渡す（ファイル App やカレンダーに渡せる）。
 * ほかは <a download> で保存する
 */

export type ExportFormat = 'json' | 'ics';
export type ExportResult = 'saved' | 'shared' | 'cancelled' | 'offline' | 'failed';

export const EXPORT_MESSAGES: Record<ExportResult, string | null> = {
  saved: '書き出しました',
  shared: null,
  cancelled: null,
  offline: '家のサーバーにつながらないので書き出せません',
  failed: '書き出せませんでした',
};

/** Content-Disposition の filename（なければ ito.<形式>） */
export function fileNameOf(disposition: string | null, format: ExportFormat): string {
  const m = /filename="([^"]+)"/.exec(disposition ?? '');
  const name = m?.[1] ?? '';
  return /^[\w.-]{1,64}$/.test(name) ? name : `ito.${format}`;
}

export interface ExportEnv {
  fetcher?: Fetcher;
  /** iPhone の共有シート（テストで差し替える） */
  share?: ((data: { files: File[]; title: string }) => Promise<void>) | null;
  canShare?: ((data: { files: File[] }) => boolean) | null;
  /** <a download> で保存する（テストで差し替える） */
  save?: (blob: Blob, name: string) => void;
  platform?: ReturnType<typeof detectPlatform>;
}

function saveWithLink(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // すぐに消すとダウンロードが始まらないことがある
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadExport(
  format: ExportFormat,
  env: ExportEnv = {},
): Promise<ExportResult> {
  let res: Awaited<ReturnType<typeof apiFile>>;
  try {
    res = await apiFile(
      `/api/export?format=${format}`,
      env.fetcher ? { fetcher: env.fetcher } : {},
    );
  } catch (e) {
    return e instanceof NetworkError ? 'offline' : 'failed';
  }
  if (res.status !== 200) return 'failed';
  const name = fileNameOf(res.headers.get('content-disposition'), format);
  const type = format === 'ics' ? 'text/calendar' : 'application/json';
  const platform = env.platform ?? detectPlatform();
  const nav = globalThis.navigator as Navigator | undefined;
  const share =
    env.share !== undefined ? env.share : nav?.share ? (d: ShareData) => nav.share(d) : null;
  const canShare =
    env.canShare !== undefined
      ? env.canShare
      : nav?.canShare
        ? (d: ShareData) => nav.canShare(d)
        : null;
  if (platform === 'ios' && share && canShare) {
    const file = new File([res.blob], name, { type });
    if (canShare({ files: [file] })) {
      try {
        await share({ files: [file], title: 'いと' });
        return 'shared';
      } catch (e) {
        // 共有シートを閉じた
        if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      }
    }
  }
  (env.save ?? saveWithLink)(new Blob([res.blob], { type }), name);
  return 'saved';
}
