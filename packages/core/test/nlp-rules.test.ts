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

  it('呼び名は長い順に照合する（「お父さん」を「父」より先に）', () => {
    expect(parseRules('明日 散歩 お父さん', ctx).draft.memberIds).toEqual([ID.父]);
    expect(parseRules('明日 散歩 ハル', ctx).draft.memberIds).toEqual([ID.はると]);
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

  it('書いてあったもの（日付・時刻・人）を返す（書いていないものは画面で選んだものを残すため）', () => {
    expect(parseRules('E2E 運動会', ctx).found).toEqual({
      date: false,
      time: false,
      members: false,
    });
    expect(parseRules('明日 歯医者', ctx).found).toEqual({
      date: true,
      time: false,
      members: false,
    });
    expect(parseRules('15時 会議 母', ctx).found).toEqual({
      date: false,
      time: true,
      members: true,
    });
    expect(parseRules('毎週月 ゴミ', ctx).found.date).toBe(true);
    expect(parseRules('10/3 午後 買い物', ctx).found.time).toBe(true);
    expect(parseRules('内緒 ケーキ', ctx).found.members).toBe(true);
  });
});
