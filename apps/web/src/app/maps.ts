/** 地図のリンク（§18 T4: encodeURIComponent で組み立てる。iPhone は Apple のマップ、ほかは Google マップ） */
export function mapUrl(query: string, platform: 'ios' | 'android' | 'other'): string {
  const q = encodeURIComponent(query);
  return platform === 'ios'
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
