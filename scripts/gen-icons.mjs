// UI 担当 AI の icon.svg から PWA のアイコンを作る（192・512・maskable 512・apple-touch-icon 180。SPEC §17）。
// 使い方: node scripts/gen-icons.mjs（icon.svg を変えたら作り直してコミットする）
// icon.svg の <metadata>（C2PA の署名など）は描画に使わないので、取り除いてから描く。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'apps/web/package.json'));
const { Resvg } = require('@resvg/resvg-js');

const svg = readFileSync(path.join(repo, 'apps/web/src/ui/icon.svg'), 'utf8').replace(
  /<metadata>[\s\S]*?<\/metadata>/g,
  '',
);
const outDir = path.join(repo, 'apps/web/public/icons');
mkdirSync(outDir, { recursive: true });

function render(size, source = svg) {
  return new Resvg(source, { fitTo: { mode: 'width', value: size }, background: '#F9F6F2' })
    .render()
    .asPng();
}

/** maskable は安全域（中央 80%）に収めるため、紙の色の地に 80% で置く */
function maskable(size) {
  const inner = svg
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<svg([^>]*)>/, '<svg$1 x="51.2" y="51.2" width="409.6" height="409.6">');
  const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#F9F6F2"/>${inner}</svg>`;
  return render(size, wrapped);
}

writeFileSync(path.join(outDir, 'icon-192.png'), render(192));
writeFileSync(path.join(outDir, 'icon-512.png'), render(512));
writeFileSync(path.join(outDir, 'icon-maskable-512.png'), maskable(512));
writeFileSync(path.join(outDir, 'apple-touch-icon-180.png'), render(180));
process.stdout.write('icons written (from ui/icon.svg)\n');
