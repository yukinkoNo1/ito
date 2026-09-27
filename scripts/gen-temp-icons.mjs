// 仮アイコン（Phase 2）。node の zlib だけで PNG を作る: 紙の色の地に朱色の縦の糸 3 本。
// Phase 6 で UI 担当 AI の icon.svg から作り直す（scripts/gen-icons.mjs）。
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repo, 'apps/web/public/icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, maskable) {
  const paper = [0xf9, 0xf6, 0xf2];
  const shu = [0xe0, 0x4e, 0x24];
  const raw = Buffer.alloc((size * 3 + 1) * size);
  // maskable は安全域（中央 80%）に収める
  const inset = maskable ? 0.2 : 0.12;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let color = paper;
      const inV = v > inset && v < 1 - inset;
      for (const cx of [0.35, 0.5, 0.65]) {
        if (inV && Math.abs(u - cx) < 0.035) color = shu;
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = color[0];
      raw[o + 1] = color[1];
      raw[o + 2] = color[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(path.join(outDir, 'icon-192.png'), png(192, false));
writeFileSync(path.join(outDir, 'icon-512.png'), png(512, false));
writeFileSync(path.join(outDir, 'icon-maskable-512.png'), png(512, true));
writeFileSync(path.join(outDir, 'apple-touch-icon-180.png'), png(180, false));
process.stdout.write('icons written\n');
