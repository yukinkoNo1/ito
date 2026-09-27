import type { EditScope } from '@ito/core';

/**
 * オフラインで禁止する操作（§12）: 繰り返し予定の「これ以降」「すべて」の編集・削除。
 * C-04（繰り返しの範囲ダイアログ）で無効にして理由を出すのに使う（Phase 3）。
 * 「この回だけ」と繰り返しでない予定は、オフラインでも送信待ちに積める。
 */
export function offlineRestriction(input: {
  online: boolean;
  recurring: boolean;
  scope: EditScope;
}): { allowed: true } | { allowed: false; reason: string } {
  if (input.online || !input.recurring || input.scope === 'this') return { allowed: true };
  return {
    allowed: false,
    reason:
      'つながっていないときは「この回だけ」しか変えられません（ほかの回の変更は家のサーバーでまとめて行うため）',
  };
}
