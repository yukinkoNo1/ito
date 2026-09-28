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

/*
 * 見えない文字・制御文字（総点検 A6）。名前が別の家族と同じに見えるのを防ぐ（ゼロ幅・双方向の上書き・制御文字）。
 * 絵文字の組み立て（ZWJ・異体字セレクタ・肌の色・旗のタグ・キーキャップ）と漢字の異体字セレクタ（IVS）は許す
 */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u{2800}]/u;
const ALLOWED_INVISIBLE = [
  /(?<=\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]?)\u{200D}(?=\p{Extended_Pictographic})/gu,
  /(?<=\p{Extended_Pictographic})[\u{FE0E}\u{FE0F}]/gu,
  /(?<=[0-9#*])\u{FE0F}(?=\u{20E3})/gu,
  /(?<=\p{Ideographic})[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/gu,
  /(?<=\u{1F3F4}[\u{E0020}-\u{E007E}]*)[\u{E0020}-\u{E007F}]/gu,
];

function withoutAllowedInvisible(value: string): string {
  return ALLOWED_INVISIBLE.reduce((v, re) => v.replace(re, ''), value);
}

/** ゼロ幅・双方向の上書き・制御文字などの見えない文字を含むか（絵文字と漢字の異体字の組み立ては除く） */
export function hasHiddenCharacters(value: string): boolean {
  return HIDDEN.test(withoutAllowedInvisible(value));
}

/** 見えない文字を取り除く（Tailscale の表示名から自動登録するとき） */
export function removeHiddenCharacters(value: string): string {
  let out = '';
  for (const g of graphemes(value)) {
    if (!hasHiddenCharacters(g)) {
      out += g;
      continue;
    }
    out += Array.from(g)
      .filter((ch) => !HIDDEN.test(ch))
      .join('');
  }
  return out;
}

/**
 * 見た目の 1 文字の長さ（UTF-16）の上限。家族の絵文字・肌の色の組み合わせは収まり、結合文字を何千も付けた
 * 「1 文字」は通さない（総点検 B5）
 */
const MAX_UNITS_PER_GRAPHEME = 16;

/** 見た目で max 文字以内か。1 文字の長さと、全体の長さ（UTF-16 で max×4、最低 16）も確かめる（総点検 B5） */
export function withinGraphemes(value: string, max: number): boolean {
  if (value.length > Math.max(16, max * 4)) return false;
  const g = graphemes(value);
  return g.length <= max && g.every((x) => x.length <= MAX_UNITS_PER_GRAPHEME);
}

/**
 * 見た目で max 文字に収める。長すぎる 1 文字（結合文字を大量に付けたもの）は除き、全体の長さの上限
 * （withinGraphemes と同じ）も守る（Tailscale の表示名から自動登録するときなど。総点検のレビュー C10）
 */
export function fitGraphemes(value: string, max: number): string {
  const limit = Math.max(16, max * 4);
  let out = '';
  let count = 0;
  for (const g of graphemes(value)) {
    if (g.length > MAX_UNITS_PER_GRAPHEME) continue;
    if (count >= max || out.length + g.length > limit) break;
    out += g;
    count++;
  }
  return out;
}

/**
 * 名前を比べるときの鍵（NFC・前後の空白除去のあと、見た目を変えない文字（異体字セレクタ・ZWJ・タグなど。
 * Default_Ignorable_Code_Point）を除く）。見た目が同じ名前を別の名前として通さない（総点検のレビュー C9）
 */
export function nameKey(value: string): string {
  return normalizeText(value).replace(/\p{Default_Ignorable_Code_Point}/gu, '');
}
