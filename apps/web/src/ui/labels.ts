/** 表示だけに使う小さな文言の組み立て（データは持たない） */

/** 通知のオフセット（分。負=前）→ 札の文言。終日は開始日 0:00 基準（-240 = 前日 20:00、420 = 当日 7:00） */
export function reminderLabel(offset: number, allDay: boolean): string {
  if (allDay) {
    const dayShift = Math.floor(offset / 1440);
    const minutes = ((offset % 1440) + 1440) % 1440;
    const time = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    const day =
      dayShift === 0
        ? '当日'
        : dayShift === -1
          ? '前日'
          : dayShift === 1
            ? '翌日'
            : dayShift > 0
              ? `${dayShift}日後`
              : `${-dayShift}日前`;
    return `${day}${time}`;
  }
  if (offset === 0) return '開始時';
  const abs = Math.abs(offset);
  const unit =
    abs % 1440 === 0 ? `${abs / 1440}日` : abs % 60 === 0 ? `${abs / 60}時間` : `${abs}分`;
  if (abs === 1440 && offset < 0) return '前日';
  return offset < 0 ? `${unit}前` : `開始${unit}後`;
}

/** 文の中の http(s) の URL を切り出す（リンクにするのは http(s) だけ。§18 T4） */
export interface TextPart {
  text: string;
  href: string | null;
  /** 文の中の位置（React の key に使う） */
  at: number;
}

export function splitLinks(text: string): TextPart[] {
  const out: TextPart[] = [];
  const re = /https?:\/\/[^\s<>"'（）「」]+/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start), href: null, at: last });
    let href = m[0];
    // 文末の句読点はリンクに含めない
    const trailing = /[.,。、)）]+$/.exec(href)?.[0] ?? '';
    if (trailing) href = href.slice(0, -trailing.length);
    try {
      const url = new URL(href);
      if (url.protocol === 'http:' || url.protocol === 'https:')
        out.push({ text: href, href: url.href, at: start });
      else out.push({ text: href, href: null, at: start });
    } catch {
      out.push({ text: href, href: null, at: start });
    }
    if (trailing) out.push({ text: trailing, href: null, at: start + href.length });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), href: null, at: last });
  return out;
}
