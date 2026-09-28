import { addDays, type EventRecord, fromJst, uuidv7 } from '@ito/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFeedToken } from '../src/services/feed-tokens';
import { dueReminders } from '../src/services/notifier';
import { insertRecord } from '../src/services/records';
import { as, createEvent, IDS, seedFamily } from './family';
import { createTestContext, devEnv, send, type TestContext } from './helpers';

/**
 * 性能の確認（§19。RUNBOOK 7. Phase 7）: 1 年分の予定で、全件同期が 1MB 未満、表示用フィード（3 日分）が 20KB 未満・
 * 100ms 未満、変化がなければ 304
 */

const NOW = fromJst('2026-09-29', '07:30');
const FAMILY = [IDS.papa, IDS.mama, IDS.yuki, IDS.haru];
const TITLES = ['歯医者', '塾', '会議', 'サッカーの練習', '買い物', '美容院', '保護者会', '夕食'];

let ctx: TestContext;
beforeEach(() => {
  ctx = createTestContext(devEnv(), { now: NOW });
  seedFamily(ctx);
});
afterEach(() => ctx.close());

/**
 * 家族 4 人の 1 年分（今日の前後半年）: 1 日 6 件の予定（時刻あり 5・終日 1。場所・メモは 3 件に 1 件）と、
 * 毎日・毎週の繰り返し 10 本。合わせて約 2,200 行
 */
function seedYear(): number {
  const db = ctx.database.db;
  let n = 0;
  const start = addDays('2026-09-29', -183);
  for (let d = 0; d < 366; d++) {
    const date = addDays(start, d);
    for (let i = 0; i < 6; i++) {
      n++;
      const owner = FAMILY[(d + i) % 4] as string;
      const allDay = i === 5;
      const hour = 8 + i * 2;
      const at = fromJst(date, `${String(hour).padStart(2, '0')}:00`);
      const record: EventRecord = {
        id: uuidv7(NOW + n),
        version: 1,
        title: `${TITLES[n % TITLES.length]}（${n}）`,
        note: n % 3 === 0 ? '持ち物: 保険証・診察券。終わったら連絡する' : null,
        location: n % 3 === 1 ? '駅前のビル 3F' : null,
        allDay,
        startAt: allDay ? null : at,
        endAt: allDay ? null : at + 60 * 60 * 1000,
        startDate: allDay ? date : null,
        endDate: allDay ? date : null,
        rrule: null,
        exdates: [],
        parentId: null,
        recurrenceId: null,
        memberIds: [owner],
        forEveryone: false,
        busy: !allDay,
        visibility: n % 10 === 0 ? 'private' : 'family',
        ownerId: owner,
        createdBy: owner,
        updatedBy: owner,
        deletedBy: null,
        createdAt: NOW - 1000,
        updatedAt: NOW - 1000,
        deletedAt: null,
      };
      insertRecord(db, record);
    }
  }
  for (let s = 0; s < 10; s++) {
    n++;
    const owner = FAMILY[s % 4] as string;
    const at = fromJst(start, `${String(6 + s).padStart(2, '0')}:30`);
    insertRecord(db, {
      id: uuidv7(NOW + n),
      version: 1,
      title: `繰り返し${s}`,
      note: null,
      location: null,
      allDay: false,
      startAt: at,
      endAt: at + 30 * 60 * 1000,
      startDate: null,
      endDate: null,
      rrule: s < 4 ? 'FREQ=DAILY' : 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      exdates: [],
      parentId: null,
      recurrenceId: null,
      memberIds: [owner],
      forEveryone: false,
      busy: true,
      visibility: 'family',
      ownerId: owner,
      createdBy: owner,
      updatedBy: owner,
      deletedBy: null,
      createdAt: NOW - 1000,
      updatedAt: NOW - 1000,
      deletedAt: null,
    });
  }
  return n;
}

describe('性能（§19）', () => {
  it('1 年分の全件同期は、送る量が 1MB 未満（gzip。§24 D38）', async () => {
    const rows = seedYear();
    expect(rows).toBeGreaterThan(2000);
    const res = await send(ctx, 'GET', '/api/sync?cursor=0', {
      headers: { ...as('papa'), 'accept-encoding': 'gzip, deflate, br' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('vary')).toContain('Accept-Encoding');
    const wire = new Uint8Array(await res.arrayBuffer());
    expect(wire.length).toBeLessThan(1024 * 1024);
    // 中身はそのまま読める（全件）
    const text = await new Response(
      new Blob([wire]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text();
    const body = JSON.parse(text) as { full: boolean; events: unknown[] };
    expect(body.full).toBe(true);
    expect(body.events).toHaveLength(rows);
    // Accept-Encoding がなければ圧縮しない
    const plain = await send(ctx, 'GET', '/api/sync?cursor=0', { headers: as('papa') });
    expect(plain.headers.get('content-encoding')).toBeNull();
  });

  it('表示用フィード（3 日分）は 20KB 未満・100ms 未満。変化がなければ 304', async () => {
    seedYear();
    const { token } = createFeedToken(ctx.database.db, ctx.clock, 'いえボード');
    const get = (headers: Record<string, string> = {}) =>
      send(ctx, 'GET', '/api/feed/display?days=3', {
        csrf: false,
        headers: { authorization: `Bearer ${token}`, ...headers },
      });
    // 1 回目は準備（モジュールの読み込みなど）を含むので、2 回目から測る
    await get();
    const t0 = performance.now();
    const res = await get();
    const ms = performance.now() - t0;
    expect(res.status).toBe(200);
    const bytes = new TextEncoder().encode(await res.text()).length;
    expect(bytes).toBeLessThan(20 * 1024);
    expect(ms).toBeLessThan(100);
    const etag = res.headers.get('etag') as string;
    const again = await get({ 'if-none-match': etag });
    expect(again.status).toBe(304);
  });

  it('1970 年に始まる毎日の繰り返しを 60 件作られても、表示用フィードと通知の計算は 200ms 未満。回の出ない規則は 422（総点検 B1）', async () => {
    for (let i = 0; i < 60; i++) {
      const { res } = await createEvent(ctx, 'yuki', {
        title: `毎日 ${i}`,
        allDay: i % 2 === 0,
        ...(i % 2 === 0 ? { startDate: '1970-01-01' } : { startAt: '1970-01-01T07:30:00+09:00' }),
        rrule: i % 3 === 0 ? 'FREQ=DAILY' : 'FREQ=DAILY;BYDAY=MO,WE,FR',
        memberIds: [IDS.yuki],
      });
      expect(res.status).toBe(201);
    }
    for (const rrule of [
      'FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30,31',
      'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31',
    ]) {
      // ゆきは 1 分に 60 件の上限に達しているので、お母さんで試す
      const { res } = await createEvent(ctx, 'mama', {
        title: '回の出ない規則',
        allDay: true,
        startDate: '1970-01-01',
        rrule,
        memberIds: [IDS.mama],
      });
      expect([rrule, res.status]).toEqual([rrule, 422]);
    }
    const { token } = createFeedToken(ctx.database.db, ctx.clock, 'いえボード');
    const get = () =>
      send(ctx, 'GET', '/api/feed/display?days=3', {
        csrf: false,
        headers: { authorization: `Bearer ${token}` },
      });
    await get();
    const t0 = performance.now();
    const res = await get();
    const feedMs = performance.now() - t0;
    expect(res.status).toBe(200);
    // 直す前は 1 件およそ 35ms（2 万日を歩く）× 60 件
    expect(feedMs).toBeLessThan(200);
    const t1 = performance.now();
    dueReminders(ctx.database.db, ctx.clock.now());
    expect(performance.now() - t1).toBeLessThan(200);
  });
});
