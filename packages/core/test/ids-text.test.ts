import { describe, expect, it } from 'vitest';
import { isUuid, uuidv7 } from '../src/ids';
import { memberAliasesSchema, memberMarkSchema, memberNameSchema } from '../src/members';
import { eventCreateSchema } from '../src/schemas';
import {
  fitGraphemes,
  graphemeLength,
  hasHiddenCharacters,
  nameKey,
  normalizeText,
  removeHiddenCharacters,
  truncateGraphemes,
  withinGraphemes,
} from '../src/text';

describe('uuidv7', () => {
  it('形と版・時刻順', () => {
    const a = uuidv7(1_790_000_000_000);
    const b = uuidv7(1_790_000_000_001);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(a[19]);
    expect(a < b).toBe(true);
    expect(uuidv7(1_790_000_000_000)).not.toBe(a);
  });
});

describe('text', () => {
  it('NFC と前後の空白除去', () => {
    const decomposed = 'が'; // が（分解）
    expect(normalizeText(`  ${decomposed} `)).toBe('が');
  });

  it('見た目の文字数', () => {
    expect(graphemeLength('👨‍👩‍👧')).toBe(1);
    expect(truncateGraphemes('あいうえお', 3)).toBe('あいう');
  });
});

describe('見えない文字（総点検 A6）', () => {
  // 見えない文字はソースに直接書かず、コードポイントで組み立てる
  const c = (...cps: number[]) => String.fromCodePoint(...cps);
  const ZWSP = c(0x200b);
  const ZWJ = c(0x200d);
  const RLO = c(0x202e);
  const BAD = [
    `お母さん${ZWSP}`,
    `${RLO}んさ母お`,
    `${RLO}んさ母お${c(0x202c)}`,
    `お母${c(0x07)}さん`,
    `${c(0x2066)}x${c(0x2069)}`,
    ZWSP,
    `お母さん${ZWJ}`,
    `お${ZWJ}か`,
    `お母さん${c(0xfe0f)}`,
    `お${c(0x2028)}母`,
    `お母さん${c(0x2060)}`,
    `お母さん${c(0xe0041)}`,
    c(0x2800),
    `お${c(0x3164)}母`,
    `お${c(0xad)}母`,
  ];
  const TECHNOLOGIST = c(0x1f469, 0x1f3fd, 0x200d, 0x1f4bb); // 肌の色つきの ZWJ の絵文字
  const HEART = c(0x2764, 0xfe0f);
  const RAINBOW = c(0x1f3f3, 0xfe0f, 0x200d, 0x1f308);
  const SCOTLAND = c(0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f);
  const KEYCAP = c(0x31, 0xfe0f, 0x20e3);
  const IVS = c(0x845b, 0xe0100); // 葛＋異体字セレクタ
  const GOOD = [
    'お母さん',
    c(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
    TECHNOLOGIST,
    HEART,
    RAINBOW,
    SCOTLAND,
    KEYCAP,
    `${IVS}城`,
    c(0x8fbb, 0xfe00),
    'Mama 2',
    c(0x1f1ef, 0x1f1f5),
  ];

  it('名前・略称・呼び名は制御文字・ゼロ幅・双方向の上書き文字を受け付けない', () => {
    for (const bad of BAD) {
      expect([bad, hasHiddenCharacters(bad)]).toEqual([bad, true]);
      expect([bad, memberNameSchema.safeParse(bad).success]).toEqual([bad, false]);
      expect([bad, memberAliasesSchema.safeParse([bad]).success]).toEqual([bad, false]);
    }
    for (const mark of [ZWSP, RLO, c(0x07)]) {
      expect([mark, memberMarkSchema.safeParse(mark).success]).toEqual([mark, false]);
    }
  });

  it('絵文字の組み立てと漢字の異体字（IVS）は使える', () => {
    for (const good of GOOD) {
      expect([good, hasHiddenCharacters(good)]).toEqual([good, false]);
      expect([good, memberNameSchema.safeParse(good).success]).toEqual([good, true]);
    }
    for (const mark of [TECHNOLOGIST, HEART, RAINBOW, KEYCAP, IVS]) {
      expect([mark, memberMarkSchema.safeParse(mark).success]).toEqual([mark, true]);
    }
  });

  it('removeHiddenCharacters は見えない文字だけを除き、絵文字の組み立ては残す', () => {
    expect(removeHiddenCharacters(`${RLO}おと${ZWSP}うさん${c(0x07)}`)).toBe('おとうさん');
    expect(removeHiddenCharacters(`はる${TECHNOLOGIST}${ZWSP}`)).toBe(`はる${TECHNOLOGIST}`);
  });
});

describe('結合文字を大量に付けた「1 文字」（総点検 B5）', () => {
  const c = (...cps: number[]) => String.fromCodePoint(...cps);
  const acute = (n: number) => c(0x301).repeat(n);
  const family = c(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466);

  it('見た目の文字数が上限の中でも、1 文字が長すぎる・全体が長すぎるものは通さない', () => {
    expect(withinGraphemes(`x${acute(50)}`, 1)).toBe(false);
    expect(memberMarkSchema.safeParse(`x${acute(50)}`).success).toBe(false);
    expect(memberNameSchema.safeParse(`ゆ${acute(2000)}`).success).toBe(false);
    expect(memberAliasesSchema.safeParse([`a${acute(200)}`]).success).toBe(false);
    const base = {
      allDay: true,
      startDate: '2026-10-01',
      memberIds: ['0192f5d0-0000-7000-8000-000000000001'],
    };
    expect(eventCreateSchema.safeParse({ ...base, title: `あ${acute(1000)}` }).success).toBe(false);
    expect(
      eventCreateSchema.safeParse({ ...base, title: 'x', location: `駅${acute(500)}` }).success,
    ).toBe(false);
  });

  it('家族の絵文字などの組み合わせ・ふつうの長さの文は通す', () => {
    expect(memberMarkSchema.safeParse(family).success).toBe(true);
    expect(memberNameSchema.safeParse(`はる${family}`).success).toBe(true);
    expect(withinGraphemes(family.repeat(20), 100)).toBe(true);
    expect(withinGraphemes('あ'.repeat(100), 100)).toBe(true);
    expect(withinGraphemes('あ'.repeat(101), 100)).toBe(false);
    expect(withinGraphemes(`が${c(0x3099)}`, 1)).toBe(true);
  });
});

describe('名前を比べる鍵と、長さに収める（総点検のレビュー C9・C10）', () => {
  const c = (...cps: number[]) => String.fromCodePoint(...cps);

  it('nameKey は異体字セレクタ・ZWJ・タグなど見た目を変えない文字を除く', () => {
    expect(nameKey(`お母${c(0xfe00)}さん`)).toBe(nameKey('お母さん'));
    expect(nameKey(`お母${c(0xe0100)}さん `)).toBe('お母さん');
    expect(nameKey(`ママ${c(0x1f600, 0xfe0f)}`)).toBe(nameKey(`ママ${c(0x1f600)}`));
    expect(nameKey(`パパ${c(0x1f3f4, 0xe0078, 0xe007f)}`)).toBe(nameKey(`パパ${c(0x1f3f4)}`));
    expect(nameKey('お母さん')).not.toBe(nameKey('お毋さん'));
  });

  it('fitGraphemes は長すぎる 1 文字を除き、見た目の文字数と全体の長さの上限に収める', () => {
    const acute = (n: number) => c(0x301).repeat(n);
    const family = c(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466);
    expect(fitGraphemes(`ゆ${acute(2000)}き`, 20)).toBe('き');
    expect(fitGraphemes('あ'.repeat(30), 20)).toBe('あ'.repeat(20));
    const fitted = fitGraphemes(family.repeat(8), 20);
    expect(withinGraphemes(fitted, 20)).toBe(true);
    expect(fitted.length).toBeLessThanOrEqual(80);
    expect(fitGraphemes(acute(50), 1)).toBe('');
  });
});
