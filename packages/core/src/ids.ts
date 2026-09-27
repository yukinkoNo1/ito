// crypto.getRandomValues はブラウザにも Node 22 以降にもある。core は DOM も node の型も読まないので、ここだけ宣言する
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** UUIDv7（RFC 9562）。時刻は呼び出し側の Clock から渡す */
export function uuidv7(nowMs: number): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let ts = Math.max(0, Math.floor(nowMs));
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
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
