import {
  eventCreateSchema,
  eventPatchSchema,
  recurrenceIdSchema,
  remindersPutSchema,
  toIsoJst,
  uuidSchema,
} from '@ito/core';
import type { Context } from 'hono';
import { z } from 'zod';
import type { App, AppDeps } from '../app';
import { ApiError } from '../errors';
import { RateLimiter } from '../lib/rate-limit';
import { parseBody, parseIdempotencyKey, parseIfMatch, parseWith } from '../lib/validate';
import { createEvent, deleteEvent, listTrash, restoreEvent, updateEvent } from '../services/events';
import { type StoredResponse, withIdempotency } from '../services/idempotency';
import { setMyReminders } from '../services/reminders';
import type { AppEnv } from '../types';

/** DELETE /api/events/:id?scope=&recurrenceId=（§13） */
const deleteQuerySchema = z
  .object({
    scope: z.enum(['this', 'following', 'all']).default('all'),
    recurrenceId: recurrenceIdSchema.optional(),
  })
  .strict();

/** POST /api/events/:id/restore?recurrenceId=（「この回だけ削除」の取り消し） */
const restoreQuerySchema = z.object({ recurrenceId: recurrenceIdSchema.optional() }).strict();

/** 1 メンバーの予定作成 60 件/分（§18 T10） */
const CREATE_RATE_PER_MIN = 60;

function respond(c: Context<AppEnv>, r: StoredResponse): Response {
  const isProblem =
    typeof r.body === 'object' &&
    r.body !== null &&
    'code' in r.body &&
    'status' in r.body &&
    r.status >= 400;
  return c.body(JSON.stringify(r.body), r.status as 200, {
    'Content-Type': isProblem
      ? 'application/problem+json; charset=utf-8'
      : 'application/json; charset=utf-8',
  });
}

function eventIdParam(c: Context<AppEnv>): string {
  return parseWith(uuidSchema, c.req.param('id'));
}

export function registerEventRoutes(app: App, deps: AppDeps): void {
  const { db, clock } = deps;
  const createLimiter = new RateLimiter(CREATE_RATE_PER_MIN, 60 * 1000, clock);

  app.post('/api/events', async (c) => {
    const me = c.get('me');
    const key = parseIdempotencyKey(c);
    if (!key) throw new ApiError(400, 'idempotency_key_required');
    const input = await parseBody(c, eventCreateSchema);
    const result = withIdempotency(db, clock, me.id, key, (tx) => {
      const limited = createLimiter.hit(me.id);
      if (!limited.ok) {
        throw new ApiError(429, 'rate_limited', undefined, undefined, {
          'Retry-After': String(limited.retryAfterSec),
        });
      }
      return createEvent(tx, clock, me, input);
    });
    return respond(c, result);
  });

  app.patch('/api/events/:id', async (c) => {
    const me = c.get('me');
    const id = eventIdParam(c);
    const key = parseIdempotencyKey(c);
    const patch = await parseBody(c, eventPatchSchema);
    const result = withIdempotency(db, clock, me.id, key, (tx) => {
      const ifMatch = parseIfMatch(c);
      return updateEvent(tx, clock, me, id, ifMatch, patch);
    });
    return respond(c, result);
  });

  app.delete('/api/events/:id', async (c) => {
    const me = c.get('me');
    const id = eventIdParam(c);
    const key = parseIdempotencyKey(c);
    const q = parseWith(deleteQuerySchema, {
      scope: c.req.query('scope'),
      recurrenceId: c.req.query('recurrenceId'),
    });
    const result = withIdempotency(db, clock, me.id, key, (tx) => {
      const ifMatch = parseIfMatch(c);
      return deleteEvent(tx, clock, me, id, ifMatch, q.scope, q.recurrenceId ?? null);
    });
    return respond(c, result);
  });

  app.put('/api/events/:id/reminders', async (c) => {
    const me = c.get('me');
    const id = eventIdParam(c);
    const body = await parseBody(c, remindersPutSchema);
    return c.json(setMyReminders(db, me, id, body.offsets));
  });

  app.post('/api/events/:id/restore', async (c) => {
    const me = c.get('me');
    const id = eventIdParam(c);
    const key = parseIdempotencyKey(c);
    const rid = parseWith(restoreQuerySchema, { recurrenceId: c.req.query('recurrenceId') });
    const result = withIdempotency(db, clock, me.id, key, (tx) =>
      restoreEvent(tx, clock, me, id, rid.recurrenceId ?? null),
    );
    return respond(c, result);
  });

  app.get('/api/trash', (c) => {
    const me = c.get('me');
    const items = listTrash(db, clock, me).map((t) => ({
      event: t.event,
      deletedAt: toIsoJst(t.deletedAt, true),
      deletedBy: t.deletedBy,
    }));
    return c.json({ items });
  });
}
