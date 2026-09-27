import { addDays, type DateISO, formatMdW, startOfWeek } from '@ito/core';
import { useState } from 'react';
import { useMe } from '../../app/data-context';
import { useMemberVMs } from '../../app/hooks';
import { useNav } from '../../app/nav';
import { useVmContext } from '../../app/use-vm';
import AvailabilityScreen from '../../ui/screens/AvailabilityScreen';
import type { FreePreset, FreeTimeVM } from '../../ui/types';

/**
 * S-06 空き時間。候補と時間軸の計算は Phase 7 でつなぐ（RUNBOOK 7. Phase 6 の 9.）。
 * それまでは条件の札と週の移動だけが動き、候補は出さない
 */
export function FreeContainer() {
  const ctx = useVmContext();
  const me = useMe();
  const members = useMemberVMs();
  const nav = useNav();
  const [weekOf, setWeekOf] = useState<DateISO | null>(null);
  const [preset, setPreset] = useState<FreePreset>('evenings');
  const [minDuration, setMinDuration] = useState<60 | 120 | 240>(120);
  const [memberIds, setMemberIds] = useState<string[] | null>(null);
  if (!ctx) return <p className="detail-meta">読み込み中…</p>;
  const start = weekOf ?? startOfWeek(ctx.today, me?.settings.weekStart ?? 0);
  const end = addDays(start, 6);
  const selected = memberIds ?? members.map((m) => m.id);
  const vm: FreeTimeVM = {
    rangeLabel: `${formatMdW(start)} – ${formatMdW(end)}`,
    preset,
    dayStartMin: preset === 'evenings' ? 17 * 60 : preset === 'holidays' ? 8 * 60 : 6 * 60,
    dayEndMin: 24 * 60,
    minDuration,
    memberIds: selected,
    candidates: [],
    days: [],
  };
  return (
    <AvailabilityScreen
      members={members}
      onChangeMinDuration={setMinDuration}
      onChangePreset={setPreset}
      onNextRange={() => setWeekOf(addDays(start, 7))}
      onPickSlot={(date, startMin) =>
        nav.openComposer({
          date,
          time: `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`,
        })
      }
      onPrevRange={() => setWeekOf(addDays(start, -7))}
      onToggleMember={(id) =>
        setMemberIds(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
      }
      vm={vm}
    />
  );
}
