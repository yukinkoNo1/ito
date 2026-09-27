// ui/styles.css の家族の色の規則は 4 色（asagi・momo・yamabuki・wakatake）分しかない。
// asagi の規則をひな形にして、残りの 4 色（wakakusa・fuji・ruri・kaki）の規則を作り、ui/member-colors.css に書く。
// あわせて、書き出しにない `.member-text--*`（履歴の人の名前の色）を 8 色分足す。
// 使い方: node scripts/gen-member-colors.mjs（styles.css の色の規則を変えたら作り直す）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = path.join(repo, 'apps/web/src/ui');
const css = readFileSync(path.join(uiDir, 'styles.css'), 'utf8');
const ALL = ['yamabuki', 'wakakusa', 'wakatake', 'asagi', 'fuji', 'momo', 'ruri', 'kaki'];
const MISSING = ['wakakusa', 'fuji', 'ruri', 'kaki'];

/** 一番外側の規則を { prelude, body } に分ける（@media などの中は見ない） */
function topLevelRules(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  let preludeEnd = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
      if (depth === 0) start = i + 1;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) preludeEnd = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        out.push({
          prelude: text.slice(start, preludeEnd).trim(),
          body: text.slice(preludeEnd + 1, i),
        });
        start = i + 1;
      }
    }
  }
  return out;
}

const templates = topLevelRules(css).filter(
  (r) => !r.prelude.startsWith('@') && /--asagi\b|-asagi-/.test(r.prelude + r.body),
);
const lines = [
  '/* 自動生成（scripts/gen-member-colors.mjs）。styles.css の asagi の規則をひな形にした、残りの家族の色。手で書き換えない */',
];
for (const color of MISSING) {
  for (const r of templates) {
    // セレクタの中の asagi だけを持つ部分（,区切り）を選び、ほかの色の部分は落とす
    const selectors = r.prelude
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.includes('asagi'))
      .map((s) => s.replaceAll('asagi', color))
      // styles.css にもうある色（.thread-color--* など 8 色そろっているもの）は作らない
      .filter((s) => !css.includes(`${s} {`) && !css.includes(`${s},`));
    if (selectors.length === 0) continue;
    const body = r.body.replaceAll('asagi', color).trim();
    lines.push(
      `${selectors.join(',\n')} {\n  ${body
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n  ')}\n}`,
    );
  }
}
lines.push('/* 履歴の人の名前（書き出しで使っていたが CSS がなかった） */');
for (const color of ALL)
  lines.push(`.member-text--${color} {\n  color: var(--m-${color}-text);\n}`);
writeFileSync(path.join(uiDir, 'member-colors.css'), `${lines.join('\n\n')}\n`);
process.stdout.write(`templates: ${templates.length}, colors: ${MISSING.join(',')}\n`);
