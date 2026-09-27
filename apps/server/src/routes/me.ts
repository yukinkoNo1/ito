import { memberSettingsSchema, mePatchSchema, readMemberSettings } from '@ito/core';
import { z } from 'zod';
import type { App, AppDeps } from '../app';
import { ApiError } from '../errors';
import { parseBody, parseWith } from '../lib/validate';
import { countUnread, listActivity, markActivityRead } from '../services/activity';
import { findMemberById, updateMember } from '../services/members';
import { buildSync, toMeDto } from '../services/sync';

const syncQuerySchema = z
  .object({ cursor: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0) })
  .strict();

const activityQuerySchema = z
  .object({
    before: z.string().max(64).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict();

export function registerMeRoutes(app: App, deps: AppDeps): void {
  const { db, clock, env } = deps;

  app.get('/api/me', (c) => c.json(toMeDto(c.get('me'))));

  app.patch('/api/me', async (c) => {
    const me = c.get('me');
    const patch = await parseBody(c, mePatchSchema);
    let settings: string | undefined;
    if (patch.settings) {
      const current = readMemberSettings(me.settings);
      const merged = memberSettingsSchema.parse({
        ...current,
        ...(patch.settings.theme !== undefined ? { theme: patch.settings.theme } : {}),
        ...(patch.settings.weekStart !== undefined ? { weekStart: patch.settings.weekStart } : {}),
        notifications: { ...current.notifications, ...(patch.settings.notifications ?? {}) },
      });
      settings = JSON.stringify(merged);
    }
    const next = updateMember(db, clock, env.MAX_MEMBERS, me.id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.mark !== undefined ? { mark: patch.mark } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.aliases !== undefined ? { aliases: patch.aliases } : {}),
      ...(settings !== undefined ? { settings } : {}),
    });
    return c.json(toMeDto(next));
  });

  app.get('/api/sync', (c) => {
    const q = parseWith(syncQuerySchema, c.req.query());
    const me = c.get('me');
    return c.json(buildSync(db, me, q.cursor));
  });

  app.get('/api/activity', (c) => {
    const q = parseWith(activityQuerySchema, c.req.query());
    return c.json(listActivity(db, c.get('me'), q.before ?? null, q.limit));
  });

  app.post('/api/activity/read', (c) => {
    const me = c.get('me');
    markActivityRead(db, clock, me);
    const fresh = findMemberById(db, me.id);
    if (!fresh) throw new ApiError(404, 'not_found');
    return c.json({ unreadActivity: countUnread(db, fresh) });
  });
}
