import { ExternalLink, MapPin } from 'lucide-react';
import { useRef, useState } from 'react';
import { reminderLabel, splitLinks } from '../labels';
import { Button, Input, Link } from '../primitives/Controls';
import type {
  ConflictSheetProps,
  EventDetailScreenProps,
  FieldEditSheetProps,
  MemberVM,
  OccurrenceVM,
  RecurrenceScopeDialogProps,
} from '../types';

const memberText = (occ: OccurrenceVM, members: MemberVM[]) =>
  occ.forEveryone
    ? '全員'
    : occ.memberIds
        .map((id) => members.find((member) => member.id === id)?.mark)
        .filter(Boolean)
        .join('・');

/** S-04 の「その項目だけ直す」小さなシート（日付・時刻の札、人の札） */
export function FieldEditSheet({
  open,
  field,
  draft,
  quickDates,
  quickTimes,
  members,
  saveLabel,
  canSave,
  onChangeDraft,
  onSave,
  onClose,
}: FieldEditSheetProps) {
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  if (!open) return null;
  const me = members.find((m) => m.isMe);
  const toggleMember = (id: string) => {
    const next = draft.memberIds.includes(id)
      ? draft.memberIds.filter((x) => x !== id)
      : [...draft.memberIds, id];
    onChangeDraft({ forEveryone: false, memberIds: next });
  };
  return (
    <div className="subsheet-backdrop">
      <section
        aria-label={field === 'date' ? '日時を直す' : '人を直す'}
        aria-modal="true"
        className="bottom-sheet detail-subsheet"
        role="dialog"
      >
        <div className="sheet-title">
          <strong>{field === 'date' ? '日時を直す' : '人を直す'}</strong>
          <Button onClick={onClose}>閉じる</Button>
        </div>
        {field === 'date' ? (
          <>
            <p>日付</p>
            <div className="option-rail">
              {quickDates.map((option) => (
                <Button
                  aria-pressed={draft.startDate === option.date}
                  key={option.date}
                  onClick={() => onChangeDraft({ startDate: option.date })}
                >
                  {option.label}
                </Button>
              ))}
              <Button
                aria-expanded={picker === 'date'}
                onClick={() => setPicker(picker === 'date' ? null : 'date')}
              >
                日付を選ぶ
              </Button>
            </div>
            {picker === 'date' && (
              <Input
                aria-label="日付"
                onChange={(e) => e.target.value && onChangeDraft({ startDate: e.target.value })}
                type="date"
                value={draft.startDate}
              />
            )}
            <p>時刻</p>
            <div className="option-rail">
              <Button
                aria-pressed={draft.allDay}
                onClick={() => onChangeDraft({ allDay: true, startTime: null, endTime: null })}
              >
                終日
              </Button>
              {quickTimes.map((time) => (
                <Button
                  aria-pressed={!draft.allDay && draft.startTime === time}
                  key={time}
                  onClick={() => onChangeDraft({ allDay: false, startTime: time })}
                >
                  {time.replace(/^0/, '')}
                </Button>
              ))}
              <Button
                aria-expanded={picker === 'time'}
                onClick={() => setPicker(picker === 'time' ? null : 'time')}
              >
                時刻を選ぶ
              </Button>
            </div>
            {picker === 'time' && (
              <Input
                aria-label="開始の時刻"
                onChange={(e) =>
                  e.target.value && onChangeDraft({ allDay: false, startTime: e.target.value })
                }
                type="time"
                value={draft.startTime ?? ''}
              />
            )}
          </>
        ) : (
          <div className="detail-member-options">
            {me && (
              <Button
                aria-pressed={
                  !draft.forEveryone && draft.memberIds.length === 1 && draft.memberIds[0] === me.id
                }
                onClick={() => onChangeDraft({ forEveryone: false, memberIds: [me.id] })}
              >
                自分
              </Button>
            )}
            <Button
              aria-pressed={draft.forEveryone}
              disabled={draft.isPrivate}
              onClick={() => onChangeDraft({ forEveryone: true, memberIds: [] })}
            >
              全員
            </Button>
            {members.map((member) => (
              <Button
                aria-pressed={!draft.forEveryone && draft.memberIds.includes(member.id)}
                disabled={draft.isPrivate}
                key={member.id}
                onClick={() => toggleMember(member.id)}
              >
                {member.mark}
              </Button>
            ))}
          </div>
        )}
        <Button disabled={!canSave} onClick={onSave} variant="accent">
          {saveLabel}
        </Button>
      </section>
    </div>
  );
}

/** 2 つの回の違いを 1 つ書く（C-05 の説明） */
function differenceText(mine: OccurrenceVM, theirs: OccurrenceVM, members: MemberVM[]): string {
  const when = (o: OccurrenceVM) =>
    o.allDay
      ? `${o.startDate}${o.endDate !== o.startDate ? `〜${o.endDate}` : ''} 終日`
      : `${o.startDate} ${o.startTime}開始`;
  if (mine.title !== theirs.title)
    return `家族側では「${theirs.title ?? '予定あり'}」、自分側では「${mine.title ?? '予定あり'}」に変更されています。`;
  if (when(mine) !== when(theirs))
    return `家族側では「${when(theirs)}」、自分側では「${when(mine)}」に変更されています。`;
  if (memberText(mine, members) !== memberText(theirs, members)) {
    return `家族側では「${memberText(theirs, members)}」、自分側では「${memberText(mine, members)}」に変更されています。`;
  }
  if (mine.location !== theirs.location)
    return `家族側では「${theirs.location ?? '場所なし'}」、自分側では「${mine.location ?? '場所なし'}」に変更されています。`;
  return '家族と自分が同じ予定を同時に変更しました。';
}

/** C-05 競合の解決 */
export function ConflictSheet({
  open,
  mine,
  theirs,
  theirsByName,
  deleted,
  members,
  onKeepTheirs,
  onKeepMine,
  onKeepBoth,
  onClose,
}: ConflictSheetProps) {
  if (!open) return null;
  const text =
    deleted === 'mine'
      ? `この予定を削除しましたが、そのあいだに${theirsByName}さんが変更していました。「家族の変更を使う」なら予定は残り、「自分の変更で上書き」なら削除します。`
      : deleted === 'theirs'
        ? `${theirsByName}さんがこの予定を削除していました。「家族の変更を使う」なら削除のまま、「自分の変更で上書き」「両方残す」なら自分の変更を新しい予定として残します。`
        : `${theirsByName}さんとぶつかりました。${differenceText(mine, theirs, members)}`;
  return (
    <div className="subsheet-backdrop">
      <section
        aria-label="変更のぶつかりを解決"
        aria-modal="true"
        className="bottom-sheet conflict-sheet"
        role="dialog"
      >
        <div className="sheet-title">
          <strong>変更のぶつかりを解決</strong>
          <Button onClick={onClose}>閉じる</Button>
        </div>
        <p>{text}</p>
        <Button onClick={onKeepTheirs}>家族の変更を使う</Button>
        <Button onClick={onKeepMine}>自分の変更で上書き</Button>
        <Button onClick={onKeepBoth}>両方残す</Button>
      </section>
    </div>
  );
}

/** C-04 繰り返し予定の編集・削除の範囲 */
export function RecurrenceScopeDialog({
  open,
  action,
  offline,
  onChoose,
  onCancel,
}: RecurrenceScopeDialogProps) {
  if (!open) return null;
  const verb = action === 'delete' ? '削除' : '変更';
  return (
    <div className="subsheet-backdrop">
      <section
        aria-label={`どの予定を${verb}しますか？`}
        aria-modal="true"
        className="bottom-sheet recurrence-delete-sheet"
        role="dialog"
      >
        <div className="sheet-title">
          <strong>どの予定を{verb}しますか？</strong>
          <Button onClick={onCancel}>閉じる</Button>
        </div>
        <Button onClick={() => onChoose('this')}>この予定だけ</Button>
        <Button disabled={offline} onClick={() => onChoose('following')}>
          これ以降すべて
        </Button>
        <Button disabled={offline} onClick={() => onChoose('all')}>
          すべて
        </Button>
        {offline && <p>オフライン中は、ほかの回をまとめて変更できません。</p>}
      </section>
    </div>
  );
}

/** S-04 予定の詳細（下から出るシート） */
export default function EventDetailSheet({
  detail,
  members,
  onClose,
  onEdit,
  onEditField,
  onDuplicate,
  onDelete,
  onChangeReminders,
  onOpenMap,
  onResolveConflict,
  children,
}: EventDetailScreenProps) {
  const dragStart = useRef<number | undefined>(undefined);
  const { occ } = detail;
  const privateForOther = occ.isPrivate && occ.title === null;
  const owner = members.find((member) => member.id === occ.memberIds[0]);
  const when = detail.timeLabel
    ? `${detail.dateLabel}　${detail.timeLabel}`
    : `${detail.dateLabel}　終日`;
  const toggleReminder = (offset: number) => {
    const current = detail.myReminders;
    const next = current.includes(offset)
      ? current.filter((x) => x !== offset)
      : [...current, offset].slice(-3);
    onChangeReminders(next.sort((a, b) => a - b));
  };

  return (
    <div className="sheet-backdrop sheet-backdrop--solid">
      <section
        aria-label="予定の詳細"
        aria-modal="true"
        className="full-sheet detail-sheet"
        onTouchEnd={(touchEvent) => {
          if (
            dragStart.current !== undefined &&
            (touchEvent.changedTouches[0]?.clientY ?? 0) - dragStart.current > 64
          )
            onClose();
          dragStart.current = undefined;
        }}
        onTouchStart={(touchEvent) => {
          // つまみ・見出しから、または中身が一番上のときだけ引き下ろしで閉じる。重ねた小さなシートの中は数えない
          const target = touchEvent.target as Element;
          const scroll = touchEvent.currentTarget.querySelector('.full-sheet-scroll');
          const fromHandle = target.closest('.sheet-grabber, .full-sheet-header');
          const inSubsheet = target.closest('.subsheet-backdrop');
          const atTop = (scroll?.scrollTop ?? 0) <= 0;
          dragStart.current =
            !inSubsheet && (fromHandle || atTop) ? touchEvent.touches[0]?.clientY : undefined;
        }}
        role="dialog"
      >
        <div className="sheet-grabber" aria-hidden="true" />
        <header className="full-sheet-header">
          <strong>予定の詳細</strong>
          <Button onClick={onClose}>閉じる</Button>
        </header>

        <div className="full-sheet-scroll detail-scroll">
          {occ.sync === 'conflict' && (
            <Button className="conflict-banner" onClick={onResolveConflict}>
              家族の変更とぶつかっています　確認する
            </Button>
          )}

          <div className="detail-hero">
            <p>{occ.isPrivate ? '非公開の予定' : '予定'}</p>
            <p className="detail-title">{occ.title ?? '予定あり'}</p>
            {privateForOther && owner && (
              <span className={`member-tag member-tag--${owner.color}`}>{owner.mark}</span>
            )}
          </div>

          <div className="detail-primary-fields">
            <Button disabled={!detail.canEdit} onClick={() => onEditField('date')}>
              <span>日時</span>
              <strong>{when}</strong>
              {detail.canEdit && <small>タップして直す</small>}
            </Button>
            <Button disabled={!detail.canEdit} onClick={() => onEditField('members')}>
              <span>人</span>
              <strong>{memberText(occ, members)}</strong>
              {detail.canEdit && <small>タップして直す</small>}
            </Button>
          </div>

          {!privateForOther && (
            <>
              {detail.reminderOptions.length > 0 && (
                <section className="detail-section">
                  <p className="detail-section-title">自分への通知</p>
                  <div className="option-rail">
                    <Button
                      aria-pressed={detail.myReminders.length === 0}
                      onClick={() => onChangeReminders([])}
                    >
                      なし
                    </Button>
                    {detail.reminderOptions.map((offset) => (
                      <Button
                        aria-pressed={detail.myReminders.includes(offset)}
                        key={offset}
                        onClick={() => toggleReminder(offset)}
                      >
                        {reminderLabel(offset, occ.allDay)}
                      </Button>
                    ))}
                  </div>
                </section>
              )}

              {(occ.location || occ.note || occ.recurrenceLabel) && (
                <section className="detail-section detail-info-list">
                  {occ.location && (
                    <div>
                      <span>場所</span>
                      <strong>{occ.location}</strong>
                      <Button onClick={() => onOpenMap(occ.location ?? '')}>
                        <MapPin aria-hidden="true" />
                        地図で開く
                      </Button>
                    </div>
                  )}
                  {occ.note && (
                    <div>
                      <span>メモ</span>
                      <p>
                        {splitLinks(occ.note).map((part) =>
                          part.href ? (
                            <Link
                              href={part.href}
                              key={part.at}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              {part.text}
                              <ExternalLink aria-hidden="true" />
                            </Link>
                          ) : (
                            <span key={part.at}>{part.text}</span>
                          ),
                        )}
                      </p>
                    </div>
                  )}
                  {occ.recurrenceLabel && (
                    <div>
                      <span>繰り返し</span>
                      <strong>{occ.recurrenceLabel}</strong>
                    </div>
                  )}
                </section>
              )}
              <p className="detail-meta">
                作成 {detail.createdByName}
                {detail.updatedLabel ? ` · ${detail.updatedLabel}` : ''}
              </p>
            </>
          )}
        </div>

        {detail.canEdit && (
          <footer className="detail-actions">
            <Button onClick={onEdit} variant="accent">
              編集
            </Button>
            <Button onClick={onDuplicate}>複製</Button>
            <Button onClick={onDelete}>削除</Button>
          </footer>
        )}
        {children}
      </section>
    </div>
  );
}
