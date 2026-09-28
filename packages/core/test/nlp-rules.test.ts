import { describe, expect, it } from 'vitest';
import { parseRules } from '../src/nlp/rules';
import { CASES, comparable, ctx, expected, ID } from './fixtures/nlp-cases';

describe('ルール解析（SPEC §21 の表）', () => {
  it('表は 38 件', () => {
    expect(CASES.map((c) => c[0])).toEqual(Array.from({ length: 38 }, (_, i) => i + 1));
  });

  it.each(CASES)('#%i %s', (_n, input, e) => {
    expect(comparable(parseRules(input, ctx))).toEqual(expected(e));
  });
});

describe('ルール解析の細かい決まり（§16）', () => {
  it('単語の一部（「夜釣り」の「夜」、「早朝会議」の「朝」、「家族旅行」の「家族」）は修飾語・人として扱わない', () => {
    expect(parseRules('夜釣り', ctx).draft.title).toBe('夜釣り');
    expect(parseRules('早朝会議', ctx).draft.allDay).toBe(true);
    expect(parseRules('家族旅行', ctx).draft.forEveryone).toBe(false);
  });

  it('呼び名は長い順に照合する（語の全体が人でできているときだけ。「と・、」の区切りと最後の助詞）', () => {
    expect(parseRules('明日 散歩 お父さん', ctx).draft.memberIds).toEqual([ID.父]);
    expect(parseRules('明日 散歩 ハル', ctx).draft.memberIds).toEqual([ID.はると]);
    expect(parseRules('明日 映画 父と母', ctx).draft.memberIds).toEqual([ID.父, ID.母]);
    expect(parseRules('明日 18時 みんなで夕食', ctx).draft).toMatchObject({
      forEveryone: false,
      title: 'みんなで夕食',
    });
    expect(parseRules('明日 18時 みんなで 夕食', ctx).draft).toMatchObject({
      forEveryone: true,
      title: '夕食',
    });
    // 「はる」という別の家族がいても、「はるとで」は長いほうの「はると」（短い順だと「はる」＋「とで」で読めない）
    const twin = {
      ...ctx,
      members: [...ctx.members, { id: 'm-haru2', name: 'はる', mark: 'H', aliases: [] }],
    };
    expect(parseRules('明日 散歩 はるとで', twin).draft.memberIds).toEqual([ID.はると]);
    // 1 字の略称に助詞が付いた語は人にしない（「さも」）。区切りがなければ人にしない（「父母」）
    expect(parseRules('明日 さも', ctx).draft.title).toBe('さも');
    expect(parseRules('明日 父母', ctx).draft.title).toBe('父母');
  });

  it('月曜始まりの設定では「今週・来週」を月曜から数える', () => {
    const monday = { ...ctx, weekStart: 1 as const };
    // 月曜始まりの来週（9/28〜10/4）の土曜は 10/3。日曜始まりだと 10/10 なので、それも選べる
    const r = parseRules('来週の土曜 18時 焼肉', monday);
    expect(r.draft.startDate).toBe('2026-10-03');
    expect(r.ambiguities.map((a) => a.options.map((o) => o.value))).toEqual([
      ['2026-10-03', '2026-10-10'],
    ]);
  });

  it('非公開は担当が自分だけ（全員にしない）', () => {
    const r = parseRules('内緒 明日 みんな ケーキ', ctx).draft;
    expect(r).toMatchObject({ isPrivate: true, forEveryone: false, memberIds: [ID.はると] });
  });

  it('空・空白だけでも落ちない', () => {
    expect(parseRules('   ', ctx).draft.title).toBe('');
  });

  it('書いてあったもの（日付・時刻・人・内緒・繰り返し）を返す（書いていないものは画面で選んだものを残すため）', () => {
    const none = { date: false, time: false, members: false, private: false, recurrence: false };
    expect(parseRules('E2E 運動会', ctx).found).toEqual(none);
    expect(parseRules('明日 歯医者', ctx).found).toEqual({ ...none, date: true });
    expect(parseRules('15時 会議 母', ctx).found).toEqual({ ...none, time: true, members: true });
    expect(parseRules('毎週月 ゴミ', ctx).found.date).toBe(true);
    expect(parseRules('10/3 午後 買い物', ctx).found.time).toBe(true);
    expect(parseRules('内緒 ケーキ', ctx).found.members).toBe(true);
    expect(parseRules('内緒 毎週月 通院', ctx).found).toMatchObject({
      private: true,
      recurrence: true,
    });
  });
});

/** レビュー（Phase 5）で見つかった読み違い。§21 の表の外の、よくある書き方 */
describe('ルール解析のレビューの指摘（Phase 5）', () => {
  const r = (text: string) => parseRules(text, ctx);
  const when = (text: string) => {
    const d = r(text).draft;
    return [d.startDate, d.startTime, d.endDate, d.endTime, d.title];
  };

  it('toString などプロトタイプの名前の語で落ちない', () => {
    for (const w of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(() => r(`明日 ${w} 会議`)).not.toThrow();
      expect(r(`明日 ${w}`).draft.title).toBe(w);
    }
  });

  it('「9:00〜11時」の分の数字を「19〜20時」の形として読まない', () => {
    expect(when('明日 9:00〜11時 会議')).toEqual([
      '2026-09-28',
      '09:00',
      '2026-09-28',
      '11:00',
      '会議',
    ]);
    expect(when('明日 10:15-12時 会議')).toEqual([
      '2026-09-28',
      '10:15',
      '2026-09-28',
      '12:00',
      '会議',
    ]);
  });

  it('終わりの時刻は開始からみて決める（翌のない夜ふかし、午前から続く時刻、「22〜翌1時」、24 時）', () => {
    expect(when('10/15 22時〜1時 夜釣り')).toEqual([
      '2026-10-15',
      '22:00',
      '2026-10-16',
      '01:00',
      '夜釣り',
    ]);
    expect(when('明日 20時〜2時 夜勤')).toEqual([
      '2026-09-28',
      '20:00',
      '2026-09-29',
      '02:00',
      '夜勤',
    ]);
    expect(when('10/15 午前1時〜3時 夜釣り')).toEqual([
      '2026-10-15',
      '01:00',
      '2026-10-15',
      '03:00',
      '夜釣り',
    ]);
    expect(when('10/15 22〜翌1時 夜釣り')).toEqual([
      '2026-10-15',
      '22:00',
      '2026-10-16',
      '01:00',
      '夜釣り',
    ]);
    expect(when('明日 13時〜3時 会議')).toEqual([
      '2026-09-28',
      '13:00',
      '2026-09-28',
      '15:00',
      '会議',
    ]);
    expect(when('明日 9時〜5時 仕事')).toEqual([
      '2026-09-28',
      '09:00',
      '2026-09-28',
      '17:00',
      '仕事',
    ]);
    expect(when('明日 22時〜24時 カラオケ')).toEqual([
      '2026-09-28',
      '22:00',
      '2026-09-29',
      '00:00',
      'カラオケ',
    ]);
  });

  it('夜・深夜の小さい時刻は夜中（書いた日の夜＝次の日の朝）。語の途中の「夜」「朝」を修飾語にしない', () => {
    expect(when('10/3 深夜1時 ラーメン')).toEqual([
      '2026-10-04',
      '01:00',
      '2026-10-04',
      null,
      'ラーメン',
    ]);
    expect(when('10/3 夜12時 花火')).toEqual(['2026-10-04', '00:00', '2026-10-04', null, '花火']);
    expect(when('10/3 夜中2時 x')[1]).toBe('02:00');
    expect(when('10/3 早朝5時 釣り')).toEqual(['2026-10-03', '05:00', '2026-10-03', null, '釣り']);
    // 今夜は今日の夜
    expect(when('今夜7時 飲み会')).toEqual(['2026-09-27', '19:00', '2026-09-27', null, '飲み会']);
    // 毎朝・毎晩は毎日
    const m = r('毎朝7時 ジョギング').draft;
    expect([m.recurrence, m.startTime, m.title]).toEqual([
      { kind: 'daily', interval: 1 },
      '07:00',
      'ジョギング',
    ]);
    expect(r('毎晩9時 戸締まり').draft.startTime).toBe('21:00');
  });

  it('時間帯の語と時刻のあいだに空白があってもよい（時間帯の語は件名に残さない）', () => {
    expect(when('明日 夜 7時 飲み会')).toEqual([
      '2026-09-28',
      '19:00',
      '2026-09-28',
      null,
      '飲み会',
    ]);
    expect(when('明日 午前 5時 釣り')).toEqual(['2026-09-28', '05:00', '2026-09-28', null, '釣り']);
    expect(when('明日 午後 3時 会議')).toEqual(['2026-09-28', '15:00', '2026-09-28', null, '会議']);
    expect(when('明日 午前 10時 会議')[1]).toBe('10:00');
  });

  it('繰り返しのよくある書き方（曜日の並べ方・空白・第2・4・毎月 1日）', () => {
    const rec = (text: string) => [r(text).draft.recurrence, r(text).draft.title];
    expect(rec('毎週火曜・金曜 ゴミ')).toEqual([
      { kind: 'weekly', interval: 1, weekdays: [2, 5] },
      'ゴミ',
    ]);
    expect(rec('毎週月曜と木曜 ゴミ')).toEqual([
      { kind: 'weekly', interval: 1, weekdays: [1, 4] },
      'ゴミ',
    ]);
    expect(rec('毎週 土曜 テニス')).toEqual([
      { kind: 'weekly', interval: 1, weekdays: [6] },
      'テニス',
    ]);
    expect(rec('第2・4水曜 資源ゴミ')).toEqual([
      { kind: 'monthlyByWeekday', nth: [2, 4], weekday: 3 },
      '資源ゴミ',
    ]);
    expect(rec('毎月 1日 掃除')).toEqual([{ kind: 'monthlyByDate', day: 1 }, '掃除']);
    // 曜日の字で始まる語（「金魚」）は曜日にしない
    expect(rec('毎週 土曜 金魚の世話')).toEqual([
      { kind: 'weekly', interval: 1, weekdays: [6] },
      '金魚の世話',
    ]);
  });

  it('助詞（の・は）と日付に添えた曜日は件名に残さない。曜日が日付と合わなければ聞く', () => {
    expect(when('明日の10時 会議')).toEqual(['2026-09-28', '10:00', '2026-09-28', null, '会議']);
    expect(when('土曜の10時 サッカー')).toEqual([
      '2026-10-03',
      '10:00',
      '2026-10-03',
      null,
      'サッカー',
    ]);
    expect(r('明日の朝 散歩').draft.title).toBe('散歩');
    expect(r('明日の朝 散歩').ambiguities.map((a) => a.field)).toEqual(['time']);
    expect(when('明日 19時〜 歯医者')[4]).toBe('歯医者');
    expect(when('明日19時から歯医者')).toEqual([
      '2026-09-28',
      '19:00',
      '2026-09-28',
      null,
      '歯医者',
    ]);
    expect(when('10/3(土) 運動会')).toEqual(['2026-10-03', null, '2026-10-03', null, '運動会']);
    expect(r('10/3(土) 運動会').ambiguities).toEqual([]);
    const wrong = r('10/4(土) 運動会');
    expect(wrong.draft.startDate).toBe('2026-10-04');
    expect(wrong.ambiguities.map((a) => a.options.map((o) => o.value))).toEqual([
      ['2026-10-04', '2026-10-03'],
    ]);
  });

  it('毎年で今年の日が過ぎていれば来年から（規則 6）', () => {
    expect(r('毎年 9/20 誕生日').draft.startDate).toBe('2027-09-20');
    expect(r('毎年 9/27 7時 x').draft.startDate).toBe('2027-09-27');
    expect(r('毎年 9/27 20時 x').draft.startDate).toBe('2026-09-27');
    expect(r('毎年 9/20 誕生日').ambiguities).toEqual([]);
  });

  it('ありえない毎月の日・重なる第n は繰り返しにしない（保存で断られる形を作らない）', () => {
    expect(r('毎月0日 x').draft.recurrence).toEqual({ kind: 'none' });
    expect(r('毎月32日 x').draft.recurrence).toEqual({ kind: 'none' });
    expect(r('第2・第2水曜 x').draft.recurrence).toEqual({
      kind: 'monthlyByWeekday',
      nth: [2],
      weekday: 3,
    });
  });
});
