import { addDays, type DateISO, timeFromMinutes } from '@ito/core';
import { useMemo, useState } from 'react';
import { useEvents } from '../../app/data-context';
import { useMemberVMs } from '../../app/hooks';
import { useNav } from '../../app/nav';
import { useVmContext } from '../../app/use-vm';
import AvailabilityScreen from '../../ui/screens/AvailabilityScreen';
import type { FreePreset } from '../../ui/types';
import { buildFreeTimeVM, FREE_RANGE_DAYS } from '../../viewmodels/free';

/**
 * S-06 空き時間（§5 F-18）。今日から 7 日を最初に見せ、家族みんなが空いている候補（最大 5 件）を先に出す。
 * 「この時間で書く」で、その日時を入れた書く画面（S-05）を開く（§6.2）
 */
export function FreeContainer() {
  const ctx = useVmContext();
  const events = useEvents();
  const members = useMemberVMs();
  const nav = useNav();
  const [start, setStart] = useState<DateISO | null>(null);
  const [preset, setPreset] = useState<FreePreset>('evenings');
  const [minDuration, setMinDuration] = useState<60 | 120 | 240>(120);
  const [memberIds, setMemberIds] = useState<string[] | null>(null);
  const from = start ?? ctx?.today ?? null;
  const active = members.map((m) => m.id);
  // 無効にした家族は外す（選んでいた人が無効になったときも）
  const selected = memberIds ? memberIds.filter((id) => active.includes(id)) : active;
  const selectedKey = selected.join(',');
  const nowMs = ctx?.nowMs ?? 0;
  const meId = ctx?.meId ?? '';
  const vm = useMemo(
    () =>
      from && events
        ? buildFreeTimeVM({
            events,
            start: from,
            preset,
            minDuration,
            memberIds: selectedKey ? selectedKey.split(',') : [],
            ctx: { nowMs, meId },
          })
        : null,
    [events, from, preset, minDuration, selectedKey, nowMs, meId],
  );
  if (!ctx || !from || !vm) return <p className="detail-meta">読み込み中…</p>;
  return (
    <AvailabilityScreen
      members={members}
      onChangeMinDuration={setMinDuration}
      onChangePreset={setPreset}
      onNextRange={() => setStart(addDays(from, FREE_RANGE_DAYS))}
      onPickSlot={(date, startMin) => nav.openComposer({ date, time: timeFromMinutes(startMin) })}
      onPrevRange={() => setStart(addDays(from, -FREE_RANGE_DAYS))}
      onToggleMember={(id) =>
        setMemberIds(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
      }
      vm={vm}
    />
  );
}
