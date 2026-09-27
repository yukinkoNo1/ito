import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../primitives/Controls';
import type { FreeDayVM, FreePreset, FreeTimeScreenProps, MemberVM } from '../types';

const PRESETS: { value: FreePreset; label: string }[] = [
  { value: 'evenings', label: '夜 17–24時' },
  { value: 'holidays', label: '休日 8–24時' },
  { value: 'all', label: '終日 6–24時' },
];

const DURATIONS: { value: 60 | 120 | 240; label: string }[] = [
  { value: 60, label: '1時間' },
  { value: 120, label: '2時間' },
  { value: 240, label: '半日' },
];

/** 時間軸の中の位置（%）。範囲 [dayStartMin, dayEndMin] に収める */
function span(startMin: number, endMin: number, from: number, to: number) {
  const s = Math.max(from, Math.min(to, startMin));
  const e = Math.max(from, Math.min(to, endMin));
  const width = to - from;
  return { left: `${((s - from) / width) * 100}%`, width: `${((e - s) / width) * 100}%` };
}

function TimelineDay({
  day,
  label,
  members,
  memberIds,
  from,
  to,
}: {
  day: FreeDayVM;
  label: string;
  members: MemberVM[];
  memberIds: string[];
  from: number;
  to: number;
}) {
  const ticks = [6, 12, 18, 24].filter((h) => h * 60 >= from && h * 60 <= to);
  return (
    <div className="availability-day">
      <strong>{label}</strong>
      <div className="availability-chart">
        <span className="availability-time-labels" aria-hidden="true">
          {ticks.map((h) => (
            <i key={h}>{h}</i>
          ))}
        </span>
        <div className="availability-lanes">
          {members
            .filter((member) => memberIds.includes(member.id))
            .map((member) => (
              <div
                aria-label={`${member.name}の予定`}
                className={`availability-lane availability-lane--${member.color}`}
                key={member.id}
                role="img"
              >
                {day.busy
                  .filter((b) => b.memberId === member.id)
                  .map((b) => (
                    <span
                      className={`busy-block ${b.label === null ? 'busy-block--private' : ''}`}
                      key={`${b.startMin}-${b.endMin}`}
                      style={span(b.startMin, b.endMin, from, to)}
                      title={b.label ?? '予定あり'}
                    />
                  ))}
              </div>
            ))}
          {day.commonFree.map((f) => (
            <span
              aria-label="全員が空いている時間"
              className="free-window"
              key={`${f.startMin}-${f.endMin}`}
              role="img"
              style={span(f.startMin, f.endMin, from, to)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** S-06 空き時間（全員があいている候補を先に、時間軸は「くわしく見る」で開閉） */
export default function AvailabilityScreen({
  vm,
  members,
  onToggleMember,
  onChangePreset,
  onChangeMinDuration,
  onPrevRange,
  onNextRange,
  onPickSlot,
}: FreeTimeScreenProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const year = vm.days[0]?.date.slice(0, 4) ?? '';

  return (
    <>
      <header className="availability-header">
        <div>
          <p>{year}年</p>
          <strong>空き時間</strong>
        </div>
        <div>
          <Button aria-label="前の週" onClick={onPrevRange}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span>{vm.rangeLabel}</span>
          <Button aria-label="次の週" onClick={onNextRange}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </header>

      <section className="availability-scroll">
        <div className="availability-answer">
          <div className="section-heading">
            <div>
              <p>答え</p>
              <strong>全員があいている候補</strong>
            </div>
            <span>{vm.candidates.length}件</span>
          </div>
          {vm.candidates.length ? (
            <div className="candidate-list">
              {vm.candidates.map((candidate) => {
                const [datePart, ...rest] = candidate.label.split(' ');
                return (
                  <div className="candidate-row" key={`${candidate.date}-${candidate.startMin}`}>
                    <p>
                      <strong>{datePart}</strong>
                      <span>{rest.join(' ')}</span>
                    </p>
                    <Button
                      onClick={() =>
                        onPickSlot(candidate.date, candidate.startMin, candidate.endMin)
                      }
                    >
                      この時間で書く
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="availability-empty">
              <strong>この条件では見つかりません</strong>
              <p>時間を短くするか、次の週を探してみてください。</p>
              <div>
                <Button disabled={vm.minDuration === 60} onClick={() => onChangeMinDuration(60)}>
                  長さを短くする
                </Button>
                <Button onClick={onNextRange}>次の週を見る</Button>
              </div>
            </div>
          )}
        </div>

        <section className="availability-conditions" aria-label="条件">
          <div>
            <p>時間帯</p>
            <div className="option-rail">
              {PRESETS.map((option) => (
                <Button
                  aria-pressed={vm.preset === option.value}
                  key={option.value}
                  onClick={() => onChangePreset(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p>長さ</p>
            <div className="option-rail">
              {DURATIONS.map((option) => (
                <Button
                  aria-pressed={vm.minDuration === option.value}
                  key={option.value}
                  onClick={() => onChangeMinDuration(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p>対象の家族</p>
            <div className="option-rail">
              {members.map((member) => (
                <Button
                  aria-pressed={vm.memberIds.includes(member.id)}
                  key={member.id}
                  onClick={() => onToggleMember(member.id)}
                >
                  {member.mark}
                </Button>
              ))}
            </div>
          </div>
        </section>

        <Button
          aria-expanded={detailsOpen}
          className="availability-detail-toggle"
          onClick={() => setDetailsOpen((open) => !open)}
        >
          くわしく見る
          {detailsOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </Button>

        {detailsOpen && (
          <section className="availability-timeline" aria-label="家族の時間軸">
            <div className="timeline-legend">
              {members
                .filter((member) => vm.memberIds.includes(member.id))
                .map((member) => (
                  <span className={`timeline-legend--${member.color}`} key={member.id}>
                    <i />
                    {member.mark}
                  </span>
                ))}
              <span className="timeline-private-legend">
                <i />
                非公開
              </span>
            </div>
            {vm.days.map((day) => (
              <TimelineDay
                day={day}
                from={vm.dayStartMin}
                key={day.date}
                label={`${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8))}(${'日月火水木金土'[day.weekday]})`}
                memberIds={vm.memberIds}
                members={members}
                to={vm.dayEndMin}
              />
            ))}
          </section>
        )}
      </section>
    </>
  );
}
