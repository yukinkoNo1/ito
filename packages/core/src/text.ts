/** 名前などの比較用の正規化（NFC・前後の空白除去。SPEC §10） */
export function normalizeText(value: string): string {
  return value.normalize('NFC').trim();
}

const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

/** 見た目の 1 文字ずつに分ける（絵文字の結合も 1 文字） */
export function graphemes(value: string): string[] {
  return Array.from(segmenter.segment(value), (s) => s.segment);
}

export function graphemeLength(value: string): number {
  return graphemes(value).length;
}

/** 見た目の文字数で切り詰める */
export function truncateGraphemes(value: string, max: number): string {
  const g = graphemes(value);
  return g.length <= max ? value : g.slice(0, max).join('');
}
