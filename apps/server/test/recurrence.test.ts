import { type EventDTO, expandAll, fromJst } from '@ito/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  expandDirect,
  RECURRING_BODIES,
  RECURRING_WINDOW,
  summarize,
} from '../../../packages/core/test/fixtures/recurring';
import { allDay, as, createEvent, IDS, seedFamily, syncAs, timed } from './family';
import { createTestContext, devEnv, send, type TestContext } from './helpers';

let ctx: TestContext;
beforeEach(() => {
  ctx = createTestContext(devEnv(), { now: fromJst('2026-09-27', '14:18') });
  seedFamily(ctx);
});
afterEach(() => ctx.close());

let keySeq = 0;
async function patch(
  who: 'papa' | 'mama' | 'haru',
  id: string,
  version: number,
  body: Record<string, unknown>,
) {
  keySeq++;
  return send(ctx, 'PATCH', `/api/events/${id}`, {
    headers: { ...as(who), 'if-match': String(version), 'idempotency-key': `rp-${keySeq}` },
    body,
  });
}

async function del(who: 'papa' | 'mama' | 'haru', id: string, version: number, query = '') {
  keySeq++;
  return send(ctx, 'DELETE', `/api/events/${id}${query}`, {
    headers: { ...as(who), 'if-match': String(version), 'idempotency-key': `rd-${keySeq}` },
  });
}

/** 同期で見える、その人から見た回（key → 開始） */
async function occurrences(who: 'papa' | 'mama' | 'haru', from: string, to: string) {
  const { events } = await syncAs(ctx, who);
  return expandAll(events, fromJst(from), fromJst(to)).map((o) => ({
    key: o.key,
    start: o.allDay ? o.startDate : `${o.startDate}T${o.startTime}`,
    title: (o.event as EventDTO).title,
  }));
}

async function byId(who: 'papa' | 'mama' | 'haru', id: string): Promise<EventDTO | undefined> {
  const { events } = await syncAs(ctx, who);
  return events.find((e) => e.id === id);
}

const EX = '0192f5c9-0000-7000-8000-000000000001';
const NEW = '0192f5c9-0000-7000-8000-000000000002';

describe('繰り返しの作成（§11）', () => {
  it('rrule は決まった順にし、時刻ありの UNTIL は 23:59:59 にして保存する', async () => {
    const { res, event } = await createEvent(
      ctx,
      'papa',
      timed('2026-10-01', '19:00', null, { rrule: 'byday=th;freq=weekly;until=20261029' }),
    );
    expect(res.status).toBe(201);
    expect(event.rrule).toBe('FREQ=WEEKLY;BYDAY=TH;UNTIL=20261029T235959');
    const occ = await occurrences('papa', '2026-10-01', '2026-11-30');
    expect(occ.map((o) => o.start)).toEqual([
      '2026-10-01T19:00',
      '2026-10-08T19:00',
      '2026-10-15T19:00',
      '2026-10-22T19:00',
      '2026-10-29T19:00',
    ]);
  });

  it('終日の UNTIL は日付だけ', async () => {
    const { event } = await createEvent(
      ctx,
      'papa',
      allDay('2026-10-01', '2026-10-01', { rrule: 'FREQ=DAILY;UNTIL=20261003T235959' }),
    );
    expect(event.rrule).toBe('FREQ=DAILY;UNTIL=20261003');
  });

  it.each([
    ['FREQ=HOURLY', '毎時'],
    ['FREQ=DAILY;INTERVAL=100', '間隔'],
    ['FREQ=DAILY;COUNT=1001', '回数'],
    ['FREQ=DAILY;BYHOUR=7', 'BYHOUR'],
    ['FREQ=DAILY;UNTIL=20260901', '始まりの日より後'],
  ])('%s は 422', async (rrule, message) => {
    const { res } = await createEvent(ctx, 'papa', timed('2026-10-01', '19:00', null, { rrule }));
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain(message);
  });
});

describe('この回だけ（scope=this）', () => {
  async function series(who: 'papa' | 'mama' = 'papa', extra: Record<string, unknown> = {}) {
    const { event } = await createEvent(
      ctx,
      who,
      timed('2026-10-05', '07:30', '08:00', {
        title: '燃えるゴミ',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
        memberIds: [IDS[who]],
        ...extra,
      }),
    );
    return event;
  }

  it('例外行を作り、その回を置き換える（key は親の ID@recurrenceId のまま）。親の version も上がる', async () => {
    const s = await series();
    const res = await patch('papa', s.id, s.version, {
      scope: 'this',
      recurrenceId: '2026-10-08T07:30',
      exceptionId: EX,
      changes: { startAt: '2026-10-09T07:30:00+09:00', endAt: '2026-10-09T08:00:00+09:00' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { event: EventDTO; exception: EventDTO };
    expect(json.event.version).toBe(s.version + 1);
    expect(json.exception).toMatchObject({
      id: EX,
      parentId: s.id,
      recurrenceId: '2026-10-08T07:30',
      rrule: null,
      ownerId: IDS.papa,
    });
    expect(await occurrences('mama', '2026-10-05', '2026-10-13')).toEqual([
      { key: `${s.id}@2026-10-05T07:30`, start: '2026-10-05T07:30', title: '燃えるゴミ' },
      { key: `${s.id}@2026-10-08T07:30`, start: '2026-10-09T07:30', title: '燃えるゴミ' },
      { key: `${s.id}@2026-10-12T07:30`, start: '2026-10-12T07:30', title: '燃えるゴミ' },
    ]);
    // 同じ回をもう一度変えると、同じ例外行を更新する
    const again = await patch('papa', s.id, s.version + 1, {
      scope: 'this',
      recurrenceId: '2026-10-08T07:30',
      changes: { title: '燃えるゴミ（祝日）' },
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { exception: EventDTO }).exception).toMatchObject({
      id: EX,
      title: '燃えるゴミ（祝日）',
      startAt: '2026-10-09T07:30:00+09:00',
    });
  });

  it('古い If-Match は 409、ない回は 404、繰り返し・公開の変更は 422', async () => {
    const s = await series();
    const stale = await patch('papa', s.id, s.version + 5, {
      scope: 'this',
      recurrenceId: '2026-10-08T07:30',
      changes: { title: 'x' },
    });
    expect(stale.status).toBe(409);
    const missing = await patch('papa', s.id, s.version, {
      scope: 'this',
      recurrenceId: '2026-10-07T07:30',
      changes: { title: 'x' },
    });
    expect(missing.status).toBe(404);
    for (const changes of [{ rrule: 'FREQ=DAILY' }, { visibility: 'private' }]) {
      const res = await patch('papa', s.id, s.version, {
        scope: 'this',
        recurrenceId: '2026-10-08T07:30',
        changes,
      });
      expect(res.status).toBe(422);
    }
  });

  it('他人の非公開の繰り返しの例外行も「予定あり」（§10 の投影）', async () => {
    const s = await series('mama', { visibility: 'private', title: '通院' });
    const res = await patch('mama', s.id, s.version, {
      scope: 'this',
      recurrenceId: '2026-10-08T07:30',
      exceptionId: EX,
      changes: { title: '通院（別の病院）' },
    });
    expect(res.status).toBe(200);
    const seen = await byId('papa', EX);
    expect(seen).toMatchObject({ title: null, location: null, note: null, visibility: 'private' });
    expect(JSON.stringify(await syncAs(ctx, 'papa'))).not.toContain('通院');
  });

  it('この回だけ削除: 親の exdates に足し、その回の例外行もゴミ箱へ', async () => {
    const s = await series();
    await patch('papa', s.id, s.version, {
      scope: 'this',
      recurrenceId: '2026-10-08T07:30',
      exceptionId: EX,
      changes: { title: '変更' },
    });
    const res = await del('papa', s.id, s.version + 1, '?scope=this&recurrenceId=2026-10-08T07:30');
    expect(res.status).toBe(200);
    const parent = await byId('papa', s.id);
    expect(parent?.exdates).toEqual(['2026-10-08T07:30']);
    expect(await byId('papa', EX)).toBeUndefined();
    expect((await occurrences('papa', '2026-10-05', '2026-10-13')).map((o) => o.start)).toEqual([
      '2026-10-05T07:30',
      '2026-10-12T07:30',
    ]);
  });

  it('例外行そのものは直接変えられない（親に scope=this で送る）', async () => {
    const s = await series();
    await patch('papa', s.id, s.version, {
      scope: 'this',
      recurrenceId: '2026-10-08T07:30',
      exceptionId: EX,
      changes: { title: '変更' },
    });
    const res = await patch('papa', EX, 1, { scope: 'all', changes: { title: 'x' } });
    expect(res.status).toBe(422);
  });
});

describe('これ以降（scope=following）', () => {
  async function counted() {
    const { event } = await createEvent(
      ctx,
      'mama',
      timed('2026-10-01', '07:00', '08:00', {
        title: 'ヨガ',
        rrule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=10',
        memberIds: [IDS.mama],
      }),
    );
    return event;
  }

  it('COUNT のシリーズ: 元は UNTIL=前の回だけ、新シリーズは残りの回数。以降の例外・取り消しは破棄して件数を返す', async () => {
    const s = await counted();
    // 前の回の取り消しは残る。以降の例外・取り消しは消える
    let v = s.version;
    for (const [q, ok] of [
      ['?scope=this&recurrenceId=2026-10-08T07:00', 200],
      ['?scope=this&recurrenceId=2026-10-29T07:00', 200],
    ] as const) {
      expect((await del('mama', s.id, v, q)).status).toBe(ok);
      v++;
    }
    expect(
      (
        await patch('mama', s.id, v, {
          scope: 'this',
          recurrenceId: '2026-10-22T07:00',
          exceptionId: EX,
          changes: { title: 'ヨガ（先生が違う）' },
        })
      ).status,
    ).toBe(200);
    v++;
    // 自分の通知は新シリーズに引き継ぐ
    const put = await send(ctx, 'PUT', `/api/events/${s.id}/reminders`, {
      headers: as('mama'),
      body: { offsets: [-60, -10] },
    });
    expect(put.status).toBe(200);

    const res = await patch('mama', s.id, v, {
      scope: 'following',
      recurrenceId: '2026-10-15T07:00',
      exceptionId: NEW,
      changes: { title: 'ヨガ（上級）' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { event: EventDTO; created: EventDTO; discarded: unknown };
    expect(json.event.rrule).toBe('FREQ=WEEKLY;BYDAY=TH;UNTIL=20261008T235959');
    expect(json.event.exdates).toEqual(['2026-10-08T07:00']);
    expect(json.created).toMatchObject({
      id: NEW,
      title: 'ヨガ（上級）',
      rrule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=8',
      startAt: '2026-10-15T07:00:00+09:00',
    });
    expect(json.discarded).toEqual({ exceptions: 1, exdates: 1 });
    expect(await byId('mama', EX)).toBeUndefined();
    const occ = await occurrences('mama', '2026-10-01', '2027-01-01');
    expect(occ.map((o) => o.start)).toEqual([
      '2026-10-01T07:00',
      '2026-10-15T07:00',
      '2026-10-22T07:00',
      '2026-10-29T07:00',
      '2026-11-05T07:00',
      '2026-11-12T07:00',
      '2026-11-19T07:00',
      '2026-11-26T07:00',
      '2026-12-03T07:00',
    ]);
    const sync = (await (
      await send(ctx, 'GET', '/api/sync?cursor=0', { headers: as('mama') })
    ).json()) as {
      myReminderPrefs: { eventId: string; offsets: number[] }[];
    };
    expect(sync.myReminderPrefs).toEqual(
      expect.arrayContaining([
        { eventId: s.id, offsets: [-60, -10] },
        { eventId: NEW, offsets: [-60, -10] },
      ]),
    );
  });

  it('初回で「これ以降」は「すべて」と同じ（新シリーズを作らない）', async () => {
    const s = await counted();
    const res = await patch('mama', s.id, s.version, {
      scope: 'following',
      recurrenceId: '2026-10-01T07:00',
      exceptionId: NEW,
      changes: { title: 'ヨガ（上級）' },
    });
    expect(res.status).toBe(200);
    expect(await byId('mama', NEW)).toBeUndefined();
    expect((await byId('mama', s.id))?.title).toBe('ヨガ（上級）');
  });

  it('これ以降を削除: 前の回で終える。初回ならシリーズごとゴミ箱', async () => {
    const s = await counted();
    const res = await del(
      'mama',
      s.id,
      s.version,
      '?scope=following&recurrenceId=2026-10-15T07:00',
    );
    expect(res.status).toBe(200);
    expect((await byId('mama', s.id))?.rrule).toBe('FREQ=WEEKLY;BYDAY=TH;UNTIL=20261008T235959');
    const all = await del(
      'mama',
      s.id,
      s.version + 1,
      '?scope=following&recurrenceId=2026-10-01T07:00',
    );
    expect(all.status).toBe(200);
    expect(await byId('mama', s.id)).toBeUndefined();
  });
});

describe('すべて（scope=all）', () => {
  async function daily() {
    const { event } = await createEvent(
      ctx,
      'papa',
      timed('2026-10-01', '07:00', '07:30', {
        title: '散歩',
        rrule: 'FREQ=DAILY;COUNT=5',
        memberIds: [IDS.papa],
      }),
    );
    return event;
  }

  it('後の回から時刻を変えても、前の回は消えない（選んだ回からの差分をマスターに当てる）。例外・取り消しはリセット', async () => {
    const s = await daily();
    expect(
      (
        await patch('papa', s.id, s.version, {
          scope: 'this',
          recurrenceId: '2026-10-04T07:00',
          exceptionId: EX,
          changes: { title: '散歩（公園）' },
        })
      ).status,
    ).toBe(200);
    const res = await patch('papa', s.id, s.version + 1, {
      scope: 'all',
      recurrenceId: '2026-10-03T07:00',
      changes: { startAt: '2026-10-03T08:00:00+09:00', endAt: '2026-10-03T08:45:00+09:00' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { event: EventDTO; discarded: unknown };
    expect(json.event).toMatchObject({
      startAt: '2026-10-01T08:00:00+09:00',
      endAt: '2026-10-01T08:45:00+09:00',
    });
    expect(json.discarded).toEqual({ exceptions: 1, exdates: 0 });
    expect((await occurrences('papa', '2026-10-01', '2026-10-10')).map((o) => o.start)).toEqual([
      '2026-10-01T08:00',
      '2026-10-02T08:00',
      '2026-10-03T08:00',
      '2026-10-04T08:00',
      '2026-10-05T08:00',
    ]);
  });

  it('日付を動かしたら、毎週の曜日もずらす', async () => {
    const { event } = await createEvent(
      ctx,
      'papa',
      allDay('2026-10-05', '2026-10-05', { title: '資源ゴミ', rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
    );
    const res = await patch('papa', event.id, event.version, {
      scope: 'all',
      recurrenceId: '2026-10-12',
      changes: { startDate: '2026-10-13', endDate: '2026-10-13' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { event: EventDTO };
    expect(json.event).toMatchObject({ startDate: '2026-10-06', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
  });

  it('日時を変えなければ、例外・取り消しは残る', async () => {
    const s = await daily();
    await patch('papa', s.id, s.version, {
      scope: 'this',
      recurrenceId: '2026-10-04T07:00',
      exceptionId: EX,
      changes: { title: '散歩（公園）' },
    });
    const res = await patch('papa', s.id, s.version + 1, {
      scope: 'all',
      recurrenceId: '2026-10-02T07:00',
      changes: { title: '朝の散歩' },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { discarded: unknown }).discarded).toEqual({
      exceptions: 0,
      exdates: 0,
    });
    expect((await byId('papa', EX))?.title).toBe('散歩（公園）');
  });
});

describe('ゴミ箱と復元', () => {
  it('シリーズを消すと例外行もいっしょにゴミ箱へ、復元でいっしょに戻る', async () => {
    const { event: s } = await createEvent(
      ctx,
      'papa',
      timed('2026-10-01', '07:00', null, { rrule: 'FREQ=DAILY;COUNT=3', memberIds: [IDS.papa] }),
    );
    await patch('papa', s.id, s.version, {
      scope: 'this',
      recurrenceId: '2026-10-02T07:00',
      exceptionId: EX,
      changes: { title: '変更' },
    });
    expect((await del('papa', s.id, s.version + 1)).status).toBe(200);
    expect(await byId('papa', EX)).toBeUndefined();
    const restore = await send(ctx, 'POST', `/api/events/${s.id}/restore`, {
      headers: { ...as('papa'), 'idempotency-key': 'restore-1' },
    });
    expect(restore.status).toBe(200);
    expect((await byId('papa', EX))?.title).toBe('変更');
  });
});

describe('3 通りの展開（サーバーの API 経由）', () => {
  it('API で作って同期で受け取った予定の展開が、core を直接展開したものと同じ', async () => {
    for (const body of RECURRING_BODIES) {
      const { res } = await createEvent(ctx, 'papa', body);
      expect(res.status).toBe(201);
    }
    const { events } = await syncAs(ctx, 'mama');
    const got = summarize(
      expandAll(events, fromJst(RECURRING_WINDOW.from), fromJst(RECURRING_WINDOW.to)),
    );
    expect(got).toEqual(expandDirect(IDS.papa));
  });
});

describe('この回だけ削除の取り消し（§6.1 の「元に戻す」）', () => {
  it('restore?recurrenceId= で取り消しを外し、その回の例外行もゴミ箱から戻す', async () => {
    const { event: s } = await createEvent(
      ctx,
      'papa',
      timed('2026-10-01', '07:00', null, { rrule: 'FREQ=DAILY;COUNT=3', memberIds: [IDS.papa] }),
    );
    await patch('papa', s.id, s.version, {
      scope: 'this',
      recurrenceId: '2026-10-02T07:00',
      exceptionId: EX,
      changes: { title: '変更' },
    });
    expect(
      (await del('papa', s.id, s.version + 1, '?scope=this&recurrenceId=2026-10-02T07:00')).status,
    ).toBe(200);
    expect(await byId('papa', EX)).toBeUndefined();
    const res = await send(
      ctx,
      'POST',
      `/api/events/${s.id}/restore?recurrenceId=2026-10-02T07:00`,
      {
        headers: { ...as('papa'), 'idempotency-key': 'restore-occ-1' },
      },
    );
    expect(res.status).toBe(200);
    expect((await byId('papa', s.id))?.exdates).toEqual([]);
    expect((await byId('papa', EX))?.title).toBe('変更');
  });
});
