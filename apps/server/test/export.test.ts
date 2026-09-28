import { type EventDTO, fromJst } from '@ito/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { foldLine, icsRrule, icsText } from '../src/services/export';
import { allDay, as, createEvent, seedFamily, timed, type Who } from './family';
import { createTestContext, devEnv, send, type TestContext, tailscaleEnv, tsUser } from './helpers';

/** 書き出し（GET /api/export。§13・F-20・§18 T5） */

let ctx: TestContext;
beforeEach(() => {
  ctx = createTestContext(devEnv(), { now: fromJst('2026-09-27', '14:18') });
  seedFamily(ctx);
});
afterEach(() => ctx.close());

async function make(who: Who, body: Record<string, unknown>): Promise<EventDTO> {
  const { res, event } = await createEvent(ctx, who, body);
  expect(res.status).toBe(201);
  return event;
}

const APP = { 'x-ito-client': '1', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' };

async function exportAs(who: Who, format: 'json' | 'ics') {
  return send(ctx, 'GET', `/api/export?format=${format}`, { headers: { ...as(who), ...APP } });
}

describe('書き出し', () => {
  beforeEach(async () => {
    await make(
      'papa',
      timed('2026-10-03', '19:00', '20:00', {
        title: '歯医者, 駅前; 2F',
        location: '駅前\n歯科',
        note: 'メモ\\です',
      }),
    );
    await make(
      'haru',
      timed('2026-10-04', '10:00', null, { title: 'プレゼント選び', visibility: 'private' }),
    );
    await make(
      'papa',
      timed('2026-10-05', '09:00', null, { title: '父の内緒', visibility: 'private' }),
    );
    await make(
      'mama',
      allDay('2026-10-10', '2026-10-12', { title: '家族旅行', forEveryone: true, memberIds: [] }),
    );
  });

  it('JSON: 他人の非公開は含めない（自分の非公開は含める）。ファイル名と種類', async () => {
    const res = await exportAs('papa', 'json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="ito-20260927.json"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text).not.toContain('プレゼント選び');
    const body = JSON.parse(text) as {
      format: string;
      version: number;
      events: EventDTO[];
      members: unknown[];
    };
    expect(body).toMatchObject({ format: 'ito-export', version: 1 });
    expect(body.events.map((e) => e.title).sort()).toEqual(
      ['家族旅行', '歯医者, 駅前; 2F', '父の内緒'].sort(),
    );
    expect(body.members).toHaveLength(4);
    // はるには父の内緒が出ず、自分のプレゼント選びは出る
    const haru = (await (await exportAs('haru', 'json')).json()) as { events: EventDTO[] };
    expect(haru.events.map((e) => e.title)).toContain('プレゼント選び');
    expect(haru.events.map((e) => e.title)).not.toContain('父の内緒');
    expect(JSON.stringify(haru)).not.toContain('父の内緒');
  });

  it('ICS: VTIMEZONE・日本時間・終日の DTEND は翌日・文字のエスケープ・他人の非公開なし', async () => {
    const res = await exportAs('papa', 'ics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="ito-20260927.ics"');
    const ics = await res.text();
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // 行の区切りはすべて CRLF
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:Asia/Tokyo\r\n');
    expect(ics).toContain(
      'DTSTART;TZID=Asia/Tokyo:20261003T190000\r\nDTEND;TZID=Asia/Tokyo:20261003T200000',
    );
    expect(ics).toContain('SUMMARY:歯医者\\, 駅前\\; 2F');
    expect(ics).toContain('LOCATION:駅前\\n歯科');
    expect(ics).toContain('DESCRIPTION:メモ\\\\です');
    // 終日 10/10〜10/12 は DTEND が 10/13（含まない）
    expect(ics).toContain('DTSTART;VALUE=DATE:20261010\r\nDTEND;VALUE=DATE:20261013');
    expect(ics).toContain('CATEGORIES:全員');
    expect(ics).toContain('SUMMARY:父の内緒');
    expect(ics).toContain('CLASS:PRIVATE');
    expect(ics).not.toContain('プレゼント選び');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
  });

  it('ICS: 繰り返しは RRULE（時刻ありの UNTIL は UTC）、取り消した回は EXDATE、この回だけ変更は RECURRENCE-ID 付きの VEVENT', async () => {
    const e = await make(
      'papa',
      timed('2026-09-28', '07:30', '08:00', {
        title: '燃えるゴミ',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261031T235959',
      }),
    );
    let res = await send(
      ctx,
      'DELETE',
      `/api/events/${e.id}?scope=this&recurrenceId=2026-10-01T07:30`,
      {
        headers: { ...as('papa'), 'if-match': String(e.version) },
      },
    );
    expect(res.status).toBe(200);
    res = await send(ctx, 'PATCH', `/api/events/${e.id}`, {
      headers: { ...as('papa'), 'if-match': String(e.version + 1) },
      body: {
        scope: 'this',
        recurrenceId: '2026-10-05T07:30',
        changes: {
          title: '燃えるゴミ（祝日）',
          startAt: '2026-10-05T09:00:00+09:00',
          endAt: '2026-10-05T09:30:00+09:00',
        },
      },
    });
    expect(res.status).toBe(200);
    const ics = await (await exportAs('papa', 'ics')).text();
    const uid = `UID:${e.id}@ito`;
    expect(ics.split(uid).length - 1).toBe(2);
    // 23:59:59（日本時間）は 14:59:59Z
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261031T145959Z');
    expect(ics).toContain('EXDATE;TZID=Asia/Tokyo:20261001T073000');
    expect(ics).toContain(
      'RECURRENCE-ID;TZID=Asia/Tokyo:20261005T073000\r\nDTSTART;TZID=Asia/Tokyo:20261005T090000',
    );
    expect(ics).toContain('SUMMARY:燃えるゴミ（祝日）');
  });

  it('終日の繰り返しは日付のまま（EXDATE・RECURRENCE-ID も日付）', async () => {
    const e = await make(
      'mama',
      allDay('2026-10-01', '2026-10-01', {
        title: '月初',
        rrule: 'FREQ=MONTHLY;BYMONTHDAY=1;COUNT=3',
      }),
    );
    const res = await send(
      ctx,
      'DELETE',
      `/api/events/${e.id}?scope=this&recurrenceId=2026-11-01`,
      {
        headers: { ...as('mama'), 'if-match': String(e.version) },
      },
    );
    expect(res.status).toBe(200);
    const ics = await (await exportAs('papa', 'ics')).text();
    expect(ics).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=1;COUNT=3');
    expect(ics).toContain('EXDATE;VALUE=DATE:20261101');
  });

  it('他人の非公開の繰り返しは、例外行ごと含めない', async () => {
    const e = await make(
      'haru',
      timed('2026-09-28', '17:00', null, {
        title: '秘密の練習',
        visibility: 'private',
        rrule: 'FREQ=DAILY;COUNT=5',
      }),
    );
    const res = await send(ctx, 'PATCH', `/api/events/${e.id}`, {
      headers: { ...as('haru'), 'if-match': String(e.version) },
      body: {
        scope: 'this',
        recurrenceId: '2026-09-29T17:00',
        changes: { title: '秘密の練習（別）' },
      },
    });
    expect(res.status).toBe(200);
    for (const format of ['json', 'ics'] as const) {
      const text = await (await exportAs('papa', format)).text();
      expect(text).not.toContain('秘密の練習');
      expect(text).not.toContain(e.id);
    }
  });

  it('アプリからの fetch だけ: X-Ito-Client がない・ページ遷移・別のサイトからは 403。知らない形式は 422', async () => {
    let res = await send(ctx, 'GET', '/api/export?format=json', { headers: as('papa') });
    expect(res.status).toBe(403);
    res = await send(ctx, 'GET', '/api/export?format=json', {
      headers: {
        ...as('papa'),
        'x-ito-client': '1',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
      },
    });
    expect(res.status).toBe(403);
    res = await send(ctx, 'GET', '/api/export?format=json', {
      headers: { ...as('papa'), 'x-ito-client': '1', 'sec-fetch-site': 'cross-site' },
    });
    expect(res.status).toBe(403);
    // 知らない形式・知らないパラメータは 422
    res = await send(ctx, 'GET', '/api/export?format=csv', { headers: { ...as('papa'), ...APP } });
    expect(res.status).toBe(422);
    res = await send(ctx, 'GET', '/api/export?format=json&x=1', {
      headers: { ...as('papa'), ...APP },
    });
    expect(res.status).toBe(422);
  });

  it('本番の設定: ID ヘッダがなければ、連携キーを付けても 401 no_identity（連携キーはほかの API で効かない）', async () => {
    const prod = createTestContext(tailscaleEnv(), { now: fromJst('2026-09-27', '14:18') });
    try {
      const res = await send(prod, 'GET', '/api/export?format=json', {
        headers: { ...APP, authorization: `Bearer ito_feed_${'a'.repeat(43)}` },
      });
      expect(res.status).toBe(401);
      expect(((await res.json()) as { code: string }).code).toBe('no_identity');
      const ok = await send(prod, 'GET', '/api/export?format=json', {
        headers: { ...APP, ...tsUser('admin@example.com') },
      });
      expect(ok.status).toBe(200);
    } finally {
      prod.close();
    }
  });
});

describe('ICS の部品', () => {
  it('エスケープ・75 オクテットでの折り返し（文字の途中で切らない）', () => {
    expect(icsText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
    const line = `SUMMARY:${'あ'.repeat(40)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });

  it('時刻ありの UNTIL（浮動時刻）を UTC に、終日はそのまま', () => {
    expect(icsRrule('FREQ=DAILY;UNTIL=20261031T235959', false)).toBe(
      'FREQ=DAILY;UNTIL=20261031T145959Z',
    );
    expect(icsRrule('FREQ=DAILY;UNTIL=20261031', true)).toBe('FREQ=DAILY;UNTIL=20261031');
    expect(icsRrule('FREQ=DAILY;COUNT=3', false)).toBe('FREQ=DAILY;COUNT=3');
  });
});
