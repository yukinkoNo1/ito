import { describe, expect, it } from 'vitest';
import {
  digestDateDue,
  effectiveOffsets,
  fitPayload,
  fromJst,
  inQuietHours,
  inSendWindow,
  offsetLabel,
  PUSH_PAYLOAD_MAX_BYTES,
  type PushPayload,
  pushSubscriptionInputSchema,
  reminderAt,
  reminderKey,
  reminderOptions,
  safeNotificationPath,
  utf8Length,
} from '../src/index';

const settings = { timedDefaults: [-30], allDayDefaults: [-240] };
const family = {
  allDay: false,
  forEveryone: false,
  memberIds: ['a'],
  visibility: 'family' as const,
  ownerId: 'a',
};

describe('通知の時刻（§15・§21 通知の時刻計算）', () => {
  it('時刻あり: 開始＋オフセット（開始時 0・30 分前）', () => {
    const o = { startMs: fromJst('2026-10-03', '19:00') };
    expect(reminderAt(o, 0)).toBe(fromJst('2026-10-03', '19:00'));
    expect(reminderAt(o, -30)).toBe(fromJst('2026-10-03', '18:30'));
  });

  it('終日: 開始日 0:00（JST）基準。-240 = 前日 20:00、420 = 当日 7:00', () => {
    const o = { startMs: fromJst('2026-10-03') };
    expect(reminderAt(o, -240)).toBe(fromJst('2026-10-02', '20:00'));
    expect(reminderAt(o, 420)).toBe(fromJst('2026-10-03', '07:00'));
  });

  it('JST の境界: 0:00 開始の 30 分前は前日 23:30', () => {
    expect(reminderAt({ startMs: fromJst('2026-10-01', '00:00') }, -30)).toBe(
      fromJst('2026-09-30', '23:30'),
    );
  });

  it('送る範囲は (今−10分, 今]', () => {
    const now = fromJst('2026-10-03', '19:00');
    expect(inSendWindow(now, now)).toBe(true);
    expect(inSendWindow(now - 9 * 60_000, now)).toBe(true);
    expect(inSendWindow(now - 10 * 60_000, now)).toBe(false);
    expect(inSendWindow(now + 1, now)).toBe(false);
  });

  it('キーに開始時刻を含める（予定が動いたら別のキー）', () => {
    expect(reminderKey('e1@2026-10-03T19:00', 100, 'm1', -30)).toBe(
      'rem:e1@2026-10-03T19:00:100:m1:-30',
    );
    expect(reminderKey('e1', 100, 'm1', -30)).not.toBe(reminderKey('e1', 200, 'm1', -30));
  });
});

describe('だれにどの通知を送るか', () => {
  it('本人の行があればそれ（[] は通知なし）', () => {
    expect(effectiveOffsets(family, 'a', [0, -60], settings)).toEqual([0, -60]);
    expect(effectiveOffsets(family, 'a', [], settings)).toEqual([]);
  });

  it('行がなければ担当者に既定値（時刻あり・終日）。全員の予定は担当に含む。担当外はなし', () => {
    expect(effectiveOffsets(family, 'a', undefined, settings)).toEqual([-30]);
    expect(effectiveOffsets({ ...family, allDay: true }, 'a', undefined, settings)).toEqual([-240]);
    expect(effectiveOffsets(family, 'b', undefined, settings)).toEqual([]);
    expect(
      effectiveOffsets({ ...family, forEveryone: true, memberIds: [] }, 'b', undefined, settings),
    ).toEqual([-30]);
    // 担当外でも自分で付けられる
    expect(effectiveOffsets(family, 'b', [420], settings)).toEqual([420]);
  });

  it('他人の非公開には付けない（行があっても）', () => {
    const priv = { ...family, visibility: 'private' as const };
    expect(effectiveOffsets(priv, 'b', [0], settings)).toEqual([]);
    expect(effectiveOffsets(priv, 'a', undefined, settings)).toEqual([-30]);
  });
});

describe('まとめ・静かな時間', () => {
  it('まとめの時刻が (今−10分, 今] に入った日。0:00 をまたぐ 10 分も拾う', () => {
    expect(digestDateDue('07:00', fromJst('2026-10-03', '07:00'))).toBe('2026-10-03');
    expect(digestDateDue('07:00', fromJst('2026-10-03', '07:09'))).toBe('2026-10-03');
    expect(digestDateDue('07:00', fromJst('2026-10-03', '07:10'))).toBeNull();
    expect(digestDateDue('07:00', fromJst('2026-10-03', '06:59'))).toBeNull();
    expect(digestDateDue('23:55', fromJst('2026-10-04', '00:02'))).toBe('2026-10-03');
  });

  it('静かな時間（22:00〜7:00 は日をまたぐ。同じ時刻なら静かな時間はない）', () => {
    const q = { enabled: true, from: '22:00', to: '07:00' };
    expect(inQuietHours(fromJst('2026-10-03', '21:59'), q)).toBe(false);
    expect(inQuietHours(fromJst('2026-10-03', '22:00'), q)).toBe(true);
    expect(inQuietHours(fromJst('2026-10-04', '06:59'), q)).toBe(true);
    expect(inQuietHours(fromJst('2026-10-04', '07:00'), q)).toBe(false);
    expect(inQuietHours(fromJst('2026-10-03', '23:00'), { ...q, enabled: false })).toBe(false);
    const day = { enabled: true, from: '13:00', to: '15:00' };
    expect(inQuietHours(fromJst('2026-10-03', '14:00'), day)).toBe(true);
    expect(inQuietHours(fromJst('2026-10-03', '15:00'), day)).toBe(false);
    expect(inQuietHours(fromJst('2026-10-03', '14:00'), { ...day, to: '13:00' })).toBe(false);
  });
});

describe('文言・候補', () => {
  it('offsetLabel', () => {
    expect(offsetLabel(0, false)).toBe('開始時');
    expect(offsetLabel(-30, false)).toBe('30分前');
    expect(offsetLabel(-60, false)).toBe('1時間前');
    expect(offsetLabel(-1440, false)).toBe('1日前');
    expect(offsetLabel(15, false)).toBe('開始の15分後');
    expect(offsetLabel(-240, true)).toBe('前日 20:00');
    expect(offsetLabel(420, true)).toBe('当日 7:00');
    expect(offsetLabel(-1680, true)).toBe('2日前 20:00');
    // 上限の 1440 分（終日は開始日の 0:00 から 1 日後＝翌日 0:00）
    expect(offsetLabel(1440, true)).toBe('翌日 0:00');
    expect(offsetLabel(1440 + 1440, true)).toBe('2日後 0:00');
  });

  it('reminderOptions は今の値も候補に含める', () => {
    expect(reminderOptions(false)).toEqual([0, -10, -30, -60, -1440]);
    expect(reminderOptions(false, [-15])).toEqual([0, -10, -15, -30, -60, -1440]);
    expect(reminderOptions(true)).toEqual([420, -240, -1680]);
  });
});

describe('ペイロード（§15）', () => {
  const base: PushPayload = {
    v: 1,
    kind: 'digest',
    title: '今日の予定',
    body: '',
    url: '/',
    tag: 't',
  };

  it('2KB を超えないように本文・件名を切る（日本語は 3 バイト）', () => {
    const long = { ...base, title: 'あ'.repeat(300), body: 'い'.repeat(1000) };
    const fitted = fitPayload(long);
    expect(utf8Length(JSON.stringify(fitted))).toBeLessThanOrEqual(PUSH_PAYLOAD_MAX_BYTES);
    expect(fitted.title.startsWith('あ')).toBe(true);
    const small = { ...base, body: '短い' };
    expect(fitPayload(small)).toEqual(small);
  });

  it('utf8Length', () => {
    expect(utf8Length('a')).toBe(1);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('あ')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
  });

  it('通知を押したときの url は同一オリジンのパスだけ（ほかは /）', () => {
    expect(safeNotificationPath('/e/abc?r=2026-10-03T07%3A30')).toBe('/e/abc?r=2026-10-03T07%3A30');
    expect(safeNotificationPath('/activity')).toBe('/activity');
    for (const bad of [
      'https://evil.example.com/',
      '//evil.example.com/x',
      'javascript:alert(1)',
      '/\\evil.example.com',
      '/e/a\nb',
      '',
      null,
      42,
      `/${'a'.repeat(600)}`,
    ]) {
      expect(safeNotificationPath(bad)).toBe('/');
    }
  });

  it('購読の入力は https の endpoint だけ・未知の項目は拒否', () => {
    const keys = { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) };
    expect(
      pushSubscriptionInputSchema.safeParse({
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        keys,
      }).success,
    ).toBe(true);
    expect(
      pushSubscriptionInputSchema.safeParse({
        endpoint: 'https://web.push.apple.com/QG',
        keys,
        label: 'iPhone',
      }).success,
    ).toBe(true);
    for (const endpoint of [
      'http://fcm.googleapis.com/x',
      'https://fcm.googleapis.com',
      'https://a b/x',
      'javascript:alert(1)',
    ]) {
      expect(pushSubscriptionInputSchema.safeParse({ endpoint, keys }).success).toBe(false);
    }
    expect(
      pushSubscriptionInputSchema.safeParse({ endpoint: 'https://x.example/y', keys, extra: 1 })
        .success,
    ).toBe(false);
  });
});
