// crypto.getRandomValues はブラウザにも Node 22 以降にもある。core は DOM も node の型も読まないので、ここだけ宣言する
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

let lastMs = -1;
let lastSeq = 0;

/**
 * UUIDv7（RFC 9562）。時刻は呼び出し側の Clock から渡す。
 * 同じミリ秒の中でも順に並ぶように、rand_a の 12 ビットを連番にする（RFC 9562 6.2 の方法 1）。
 * 連番があふれたら、時刻を 1 ミリ秒進めた扱いにする。
 */
export function uuidv7(nowMs: number): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let ms = Math.max(0, Math.floor(nowMs));
  if (ms <= lastMs) {
    ms = lastMs;
    lastSeq++;
    if (lastSeq > 0xfff) {
      ms = lastMs + 1;
      lastSeq = 0;
    }
  } else {
    // 連番の始まりは 0〜2047 の乱数（あふれにくく、推測しにくく）
    lastSeq = (((bytes[6] as number) << 8) | (bytes[7] as number)) & 0x7ff;
  }
  lastMs = ms;
  let ts = ms;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = 0x70 | ((lastSeq >> 8) & 0x0f);
  bytes[7] = lastSeq & 0xff;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
    out += HEX[bytes[i] as number];
  }
  return out;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
