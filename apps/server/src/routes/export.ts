import { z } from 'zod';
import type { App, AppDeps } from '../app';
import { ApiError } from '../errors';
import { parseWith } from '../lib/validate';
import { buildIcsExport, buildJsonExport, exportFileName } from '../services/export';

const exportQuerySchema = z.object({ format: z.enum(['json', 'ics']) }).strict();

/**
 * GET /api/export?format=json｜ics（§13・F-20）。PWA が fetch で取ってファイルにする（ページ遷移で開かない）。
 * GET でも X-Ito-Client を求め、ページ遷移（Sec-Fetch-Mode: navigate）と同一オリジン以外からの要求は断る
 * （別のサイトからのリンクで家族の予定のファイルを落とさせない）
 */
export function registerExportRoutes(app: App, deps: AppDeps): void {
  const { db, clock, logger } = deps;
  app.get('/api/export', (c) => {
    if (!c.req.header('x-ito-client')) throw new ApiError(403, 'csrf', 'X-Ito-Client がありません');
    const mode = c.req.header('sec-fetch-mode');
    const site = c.req.header('sec-fetch-site');
    if (mode === 'navigate' || (site !== undefined && site !== 'same-origin')) {
      throw new ApiError(403, 'csrf', '書き出しはアプリの中からだけ使えます');
    }
    const { format } = parseWith(exportQuerySchema, c.req.query());
    const me = c.get('me');
    const now = clock.now();
    const name = exportFileName(format, now);
    const headers = { 'Content-Disposition': `attachment; filename="${name}"` };
    logger.info({ memberId: me.id, format }, 'export');
    if (format === 'json') {
      return c.body(JSON.stringify(buildJsonExport(db, me, now)), 200, {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
      });
    }
    return c.body(buildIcsExport(db, me, now), 200, {
      ...headers,
      'Content-Type': 'text/calendar; charset=utf-8',
    });
  });
}
