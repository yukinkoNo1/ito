import type { MemberVM, OccurrenceVM } from '../types';
import { Button } from './Controls';
import ThreadRail from './ThreadRail';

/** 行の右の人の札（全員なら「全員」。§6.1「誰の予定かを文字で」） */
export const memberLabel = (occ: OccurrenceVM, members: MemberVM[]) =>
  occ.forEveryone
    ? '全員'
    : occ.memberIds
        .map((id) => members.find((member) => member.id === id)?.mark)
        .filter(Boolean)
        .join('・');

/** 時刻の表示（終日・日付をまたぐと「翌」） */
export const occurrenceTimeLabel = (occ: OccurrenceVM) => {
  if (occ.allDay) return '終日';
  const crossesMidnight = occ.startDate !== occ.endDate;
  if (crossesMidnight && occ.endTime) return `${occ.startTime} → 翌${occ.endTime}`;
  return occ.startTime ?? '';
};

export default function ScheduleEventRow({
  occ,
  members,
  past = false,
  continuingIds,
  onOpen,
}: {
  occ: OccurrenceVM;
  members: MemberVM[];
  past?: boolean;
  continuingIds?: string[];
  onOpen: () => void;
}) {
  const privateForOther = occ.isPrivate && occ.title === null;
  const first = members.find((item) => item.id === occ.memberIds[0]);
  const detail = [occ.location && `@${occ.location}`, occ.recurrenceLabel]
    .filter(Boolean)
    .join(' · ');
  const syncLabel =
    occ.sync === 'pending' ? '未送信' : occ.sync === 'conflict' ? '変更がぶつかっています' : '';

  return (
    <Button
      className={`timeline-row event-row ${past ? 'event-row--past' : ''}`}
      data-fresh={occ.fresh ? 'true' : undefined}
      data-key={occ.key}
      onClick={onOpen}
    >
      <ThreadRail
        activeIds={occ.memberIds}
        continuingIds={continuingIds}
        hollow={privateForOther}
        members={members}
      />
      <span className="event-content">
        <span className="event-time">
          {occ.fresh && (
            <span className="new-mark">
              <i />新
            </span>
          )}
          <time>{occurrenceTimeLabel(occ)}</time>
        </span>
        <span className="event-copy">
          <strong>{occ.title ?? '予定あり'}</strong>
          <small>{[syncLabel, detail].filter(Boolean).join(' · ')}</small>
        </span>
        <span
          className={`member-tag ${
            occ.forEveryone || !first ? 'member-tag--everyone' : `member-tag--${first.color}`
          }`}
        >
          {memberLabel(occ, members)}
        </span>
      </span>
    </Button>
  );
}
