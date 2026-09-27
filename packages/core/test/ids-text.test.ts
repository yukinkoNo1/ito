import { describe, expect, it } from 'vitest';
import { isUuid, uuidv7 } from '../src/ids';
import { graphemeLength, normalizeText, truncateGraphemes } from '../src/text';

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
