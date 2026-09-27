import { type DeviceDTO, formatMd, parseIsoToMs, todayJst } from '@ito/core';
import type { DeviceVM } from '../ui/types';

/** 通知を受け取る端末（S-07。§22 DeviceVM）。最後に届いた日を「今日」「9/20」で。まだ届いていなければ「未確認」 */
export function toDeviceVMs(devices: DeviceDTO[], nowMs: number): DeviceVM[] {
  const today = todayJst(nowMs);
  return devices.map((d) => {
    const ms = d.lastOkAt ? parseIsoToMs(d.lastOkAt) : null;
    const date = ms === null ? null : todayJst(ms);
    return {
      id: d.id,
      label: d.label,
      lastUsedLabel: date === null ? '未確認' : date === today ? '今日' : formatMd(date),
      isThisDevice: d.isThisDevice,
    };
  });
}
