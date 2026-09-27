import { pushSubscriptionInputSchema, uuidSchema } from '@ito/core';
import { z } from 'zod';
import type { App, AppDeps, PushDeps } from '../app';
import { ApiError } from '../errors';
import { RateLimiter } from '../lib/rate-limit';
import { parseBody, parseWith } from '../lib/validate';
import { findMemberById } from '../services/members';
import { sendTestNotification } from '../services/notifier';
import {
  deleteSubscription,
  deleteSubscriptionsOf,
  listMyDevices,
  upsertSubscription,
} from '../services/push';

const devicesQuerySchema = z.object({ current: uuidSchema.optional() }).strict();

/** テスト通知は 1 人 5 回/分まで（押し続けても送り続けないように） */
const TEST_RATE_PER_MIN = 5;

function requireAdmin(role: string): void {
  if (role !== 'admin') throw new ApiError(403, 'forbidden', '家族の管理は管理者だけができます');
}

/**
 * Push の API（§13・§15）。endpoint・鍵は返さない。VAPID の鍵がなければ、公開鍵は null、テスト通知は
 * result: 'unavailable'（画面を開くたびに 4xx にしない。§24 D35）
 */
export function registerPushRoutes(app: App, deps: AppDeps & { push: PushDeps }): void {
  const { db, clock, logger, push } = deps;
  const testLimiter = new RateLimiter(TEST_RATE_PER_MIN, 60 * 1000, clock);

  app.get('/api/push/public-key', (c) => c.json({ publicKey: push.publicKey }));

  app.get('/api/push/subscriptions', (c) => {
    const q = parseWith(devicesQuerySchema, c.req.query());
    return c.json({ devices: listMyDevices(db, c.get('me'), q.current ?? null) });
  });

  app.post('/api/push/subscriptions', async (c) => {
    const input = await parseBody(c, pushSubscriptionInputSchema);
    const row = upsertSubscription(db, clock, c.get('me'), input);
    return c.json({ id: row.id });
  });

  app.delete('/api/push/subscriptions/:id', (c) => {
    const id = parseWith(uuidSchema, c.req.param('id'));
    deleteSubscription(db, c.get('me'), id);
    return c.body(null, 204);
  });

  app.delete('/api/members/:id/push-subscriptions', (c) => {
    requireAdmin(c.get('me').role);
    const id = parseWith(uuidSchema, c.req.param('id'));
    if (!findMemberById(db, id)) throw new ApiError(404, 'not_found');
    const removed = deleteSubscriptionsOf(db, id);
    return c.json({ removed });
  });

  app.post('/api/push/test', async (c) => {
    const me = c.get('me');
    if (!push.sender) return c.json({ result: 'unavailable' });
    const limited = testLimiter.hit(me.id);
    if (!limited.ok) {
      throw new ApiError(429, 'rate_limited', undefined, undefined, {
        'Retry-After': String(limited.retryAfterSec),
      });
    }
    const outcome = await sendTestNotification({ db, clock, logger, sender: push.sender }, me);
    return c.json({ result: outcome });
  });
}
