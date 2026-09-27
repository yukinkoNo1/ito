/**
 * RFC 2047 のエンコード語（=?charset?B|Q?text?=）をデコードする。
 * Tailscale-User-Name は日本語の名前のときこの形で届くことがある（SPEC §14）。
 * UTF-8 以外の文字コードや壊れた形はそのまま返す。
 */
const ENCODED_WORD = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;

function decodeBytes(bytes: Uint8Array, charset: string): string | null {
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function base64ToBytes(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  return Uint8Array.from(Buffer.from(text, 'base64'));
}

function qToBytes(text: string): Uint8Array | null {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === '_') out.push(0x20);
    else if (ch === '=') {
      const hex = text.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null;
      out.push(Number.parseInt(hex, 16));
      i += 2;
    } else out.push(ch.charCodeAt(0) & 0xff);
  }
  return Uint8Array.from(out);
}

export function decodeRfc2047(value: string): string {
  // エンコード語どうしの間の空白は取り除く（RFC 2047 6.2）
  const joined = value.replace(/\?=\s+=\?/g, '?==?');
  return joined.replace(ENCODED_WORD, (whole, charset: string, enc: string, text: string) => {
    const bytes = enc.toUpperCase() === 'B' ? base64ToBytes(text) : qToBytes(text);
    if (!bytes) return whole;
    return decodeBytes(bytes, charset) ?? whole;
  });
}
