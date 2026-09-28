import {
  addDays,
  daysInMonth,
  minutesOfTime,
  parseDate,
  timeFromMinutes,
  WEEKDAY_LABELS,
  weekdayOf,
} from '@ito/core/jst';
import { reminderOptions as reminderChoices } from '@ito/core/notify';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { reminderLabel } from '../labels';
import { Button, Input, Textarea } from '../primitives/Controls';
import type {
  ComposerSheetProps,
  EventDraftVM,
  RecurrenceEndVM,
  RecurrenceVM,
  Weekday,
} from '../types';

type RecurrenceKind = RecurrenceVM['kind'];
const RECURRENCE_OPTIONS: {
  kind: Exclude<RecurrenceKind, 'custom'> | 'biweekly';
  label: string;
}[] = [
  { kind: 'none', label: 'なし' },
  { kind: 'daily', label: '毎日' },
  { kind: 'weekly', label: '毎週' },
  { kind: 'biweekly', label: '隔週' },
  { kind: 'monthlyByDate', label: '毎月（日付）' },
  { kind: 'monthlyByWeekday', label: '毎月（第n曜日）' },
  { kind: 'yearly', label: '毎年' },
];

/** 札で選んだ繰り返しを、開始日から RecurrenceVM にする（見た目の札 → 形。表示のための小さな組み立て） */
function recurrenceFor(
  kind: (typeof RECURRENCE_OPTIONS)[number]['kind'],
  startDate: string,
): RecurrenceVM {
  const weekday = weekdayOf(startDate) as Weekday;
  const { year, month, day } = parseDate(startDate);
  switch (kind) {
    case 'none':
      return { kind: 'none' };
    case 'daily':
      return { kind: 'daily', interval: 1 };
    case 'weekly':
      return { kind: 'weekly', interval: 1, weekdays: [weekday] };
    case 'biweekly':
      return { kind: 'weekly', interval: 2, weekdays: [weekday] };
    case 'monthlyByDate':
      // 29〜31 日はそのまま入れて「月末にしますか？」と聞く（§11・§24 D33。レビュー P3-web-10）
      return { kind: 'monthlyByDate', day };
    case 'monthlyByWeekday': {
      const nth = Math.ceil(day / 7);
      return {
        kind: 'monthlyByWeekday',
        nth: [day + 7 > daysInMonth(year, month) && nth >= 4 ? -1 : nth],
        weekday,
      };
    }
    case 'yearly':
      return { kind: 'yearly' };
  }
}

function recurrencePressed(
  kind: (typeof RECURRENCE_OPTIONS)[number]['kind'],
  r: RecurrenceVM,
): boolean {
  if (kind === 'biweekly') return r.kind === 'weekly' && r.interval === 2;
  if (kind === 'weekly') return r.kind === 'weekly' && r.interval === 1;
  return r.kind === kind;
}

function endOptions(startDate: string): { label: string; value: RecurrenceEndVM }[] {
  const { year } = parseDate(startDate);
  return [
    { label: 'なし', value: { kind: 'never' } },
    { label: '10回', value: { kind: 'count', count: 10 } },
    { label: '12/31まで', value: { kind: 'until', date: `${year}-12-31` } },
  ];
}

const sameEnd = (a: RecurrenceEndVM, b: RecurrenceEndVM) => JSON.stringify(a) === JSON.stringify(b);

const shortTime = (time: string) => time.replace(/^0/, '');

/** S-05 予定を書く（一言＋候補の札。「くわしく」で同じシート内に残りの項目） */
export default function EventComposerSheet({
  open,
  vm,
  members,
  online,
  onClose,
  onTextChange,
  onSubmitText,
  onChangeDraft,
  onPickSuggestion,
  onChooseAmbiguity,
  onSetMode,
  onSave,
  children,
}: ComposerSheetProps) {
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const dragStart = useRef<number | undefined>(undefined);
  if (!open) return null;
  const draft = vm.draft;
  const me = members.find((m) => m.isMe);
  const patch = (p: Partial<EventDraftVM>) => onChangeDraft(p);
  const canSave = Boolean(draft?.title.trim() && draft.startDate) && !vm.saving;
  const today = vm.quickDates[0]?.date;
  const pickerDates = today ? Array.from({ length: 42 }, (_, i) => addDays(today, i)) : [];
  // 入力できる日付の範囲（今日から −1 年〜+3 年。§16 の検証と同じ）
  const earliest = today ? addDays(today, -366) : undefined;
  const latest = today ? addDays(today, 366 * 3) : undefined;
  const pickerTimes = Array.from({ length: 33 }, (_, i) => timeFromMinutes(6 * 60 + i * 30));
  const endOffsets = [60, 120];
  const endFor = (minutes: number) =>
    draft?.startTime ? timeFromMinutes(minutesOfTime(draft.startTime) + minutes) : null;
  const toggleMember = (id: string) => {
    if (!draft) return;
    const next = draft.memberIds.includes(id)
      ? draft.memberIds.filter((x) => x !== id)
      : [...draft.memberIds, id];
    patch({ forEveryone: false, memberIds: next });
  };
  // 詳細（S-04）と同じ候補（core の reminderOptions。今の値が候補になければ足す）
  const reminderOptions = draft ? reminderChoices(draft.allDay, draft.myReminders) : [];

  return (
    <div className="sheet-backdrop sheet-backdrop--solid">
      <section
        aria-label="予定を書く"
        aria-modal="true"
        className="full-sheet composer-sheet"
        onTouchEnd={(event) => {
          if (
            dragStart.current !== undefined &&
            (event.changedTouches[0]?.clientY ?? 0) - dragStart.current > 64
          )
            onClose();
          dragStart.current = undefined;
        }}
        onTouchStart={(event) => {
          // 書きかけを消さないよう、つまみと見出しからの引き下ろしだけで閉じる（中身のスクロールでは閉じない）
          const target = event.target as Element;
          dragStart.current = target.closest('.sheet-grabber, .full-sheet-header')
            ? event.touches[0]?.clientY
            : undefined;
        }}
        role="dialog"
      >
        <div className="sheet-grabber" aria-hidden="true" />
        <header className="full-sheet-header">
          <strong>{vm.editing ? '予定を直す' : '予定を書く'}</strong>
          <Button onClick={onClose}>閉じる</Button>
        </header>

        <div className="full-sheet-scroll">
          <Input
            aria-label={vm.editing ? '件名' : '予定を一言で入力'}
            autoFocus
            className="composer-main-input"
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              // 日本語入力の変換確定の Enter では送らない（§16。Safari は確定後にも Enter を送る）
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              event.preventDefault();
              onSubmitText();
            }}
            placeholder={vm.examples[0] ?? '10/3 10時 父 ゴルフ'}
            value={vm.text}
          />
          {vm.parse === 'parsing' && <p className="parse-confirmation">解析しています…</p>}
          {vm.parse === 'done' && (
            <p className="parse-confirmation">
              {vm.source === 'rules' ? 'かんたん解析' : '入力を解析しました'}
              。札を確認してください。
            </p>
          )}

          <div className="composer-option-group">
            <p>日付</p>
            <div className="option-rail">
              {vm.quickDates.map((option) => (
                <Button
                  aria-pressed={draft?.startDate === option.date}
                  key={option.date}
                  onClick={() => patch({ startDate: option.date })}
                >
                  {option.label}
                </Button>
              ))}
              <Button onClick={() => setPicker('date')}>日付を選ぶ</Button>
            </div>
          </div>

          <div className="composer-option-group">
            <p>時刻</p>
            <div className="option-rail">
              <Button
                aria-pressed={draft?.allDay ?? false}
                onClick={() => patch({ allDay: true, startTime: null, endTime: null })}
              >
                終日
              </Button>
              {vm.quickTimes.map((time) => (
                <Button
                  aria-pressed={draft ? !draft.allDay && draft.startTime === time : false}
                  key={time}
                  onClick={() => patch({ allDay: false, startTime: time })}
                >
                  {shortTime(time)}
                </Button>
              ))}
              <Button onClick={() => setPicker('time')}>時刻を選ぶ</Button>
            </div>
            {draft && !draft.allDay && draft.startTime && (
              <div className="option-rail option-rail--end">
                <span>終わり</span>
                {endOffsets.map((minutes) => {
                  const end = endFor(minutes);
                  return (
                    <Button
                      aria-pressed={draft.endTime !== null && draft.endTime === end}
                      key={minutes}
                      onClick={() => patch({ endTime: end })}
                    >
                      +{minutes / 60}時間
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="composer-option-group">
            <p>人</p>
            <div className="option-rail">
              {me && (
                <Button
                  aria-pressed={
                    !!draft &&
                    !draft.forEveryone &&
                    draft.memberIds.length === 1 &&
                    draft.memberIds[0] === me.id
                  }
                  onClick={() => patch({ forEveryone: false, memberIds: [me.id] })}
                >
                  自分
                </Button>
              )}
              <Button
                aria-pressed={draft?.forEveryone ?? false}
                disabled={draft?.isPrivate}
                onClick={() => patch({ forEveryone: true, memberIds: [] })}
              >
                全員
              </Button>
              {members.map((member) => (
                <Button
                  aria-pressed={
                    !!draft && !draft.forEveryone && draft.memberIds.includes(member.id)
                  }
                  disabled={draft?.isPrivate}
                  key={member.id}
                  onClick={() => toggleMember(member.id)}
                >
                  {member.mark}
                </Button>
              ))}
            </div>
          </div>

          {vm.suggestions.length > 0 && (
            <div className="recent-events">
              <p>最近の予定</p>
              {vm.suggestions.map((item, index) => (
                <Button
                  key={`${item.title}-${item.hint ?? ''}`}
                  onClick={() => onPickSuggestion(index)}
                >
                  <strong>{item.title}</strong>
                  {item.hint && <span>{item.hint}</span>}
                </Button>
              ))}
            </div>
          )}

          {vm.ambiguities.map((ambiguity, ai) => (
            <div className="clarification" key={`${ambiguity.field}-${ambiguity.question}`}>
              <strong>{ambiguity.question}</strong>
              <div>
                {ambiguity.options.map((option, oi) => (
                  <Button
                    aria-pressed={ambiguity.chosen === oi}
                    key={option.label}
                    onClick={() => onChooseAmbiguity(ai, oi)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          {(vm.error || vm.parse === 'failed') && (
            <p className="composer-error">
              {vm.error ?? '日付と時刻を読み取れませんでした。札から選んでください。'}
            </p>
          )}
          {vm.overlaps.map((overlap) => (
            <p className="overlap-warning" key={overlap}>
              {overlap}
            </p>
          ))}

          <Button
            aria-expanded={vm.mode === 'detail'}
            className="details-toggle"
            onClick={() => onSetMode(vm.mode === 'detail' ? 'quick' : 'detail')}
          >
            くわしく
            {vm.mode === 'detail' ? (
              <ChevronUp aria-hidden="true" />
            ) : (
              <ChevronDown aria-hidden="true" />
            )}
          </Button>

          {vm.mode === 'detail' && draft && (
            <div className="composer-details">
              <label>
                <span>開始日</span>
                <Input
                  max={latest}
                  min={earliest}
                  onChange={(e) => e.target.value && patch({ startDate: e.target.value })}
                  type="date"
                  value={draft.startDate}
                />
              </label>
              {!draft.allDay && (
                <>
                  <label>
                    <span>開始の時刻</span>
                    <Input
                      onChange={(e) =>
                        e.target.value && patch({ allDay: false, startTime: e.target.value })
                      }
                      type="time"
                      value={draft.startTime ?? ''}
                    />
                  </label>
                  <label>
                    <span>終わりの時刻（開始より前なら翌日）</span>
                    <Input
                      onChange={(e) => patch({ endTime: e.target.value || null })}
                      type="time"
                      value={draft.endTime ?? ''}
                    />
                  </label>
                  {draft.endTime && (
                    <Button onClick={() => patch({ endTime: null })}>終わりの時刻なし</Button>
                  )}
                </>
              )}
              {!draft.allDay ? null : (
                <label>
                  <span>最終日</span>
                  <Input
                    min={draft.startDate}
                    onChange={(e) => e.target.value && patch({ endDate: e.target.value })}
                    type="date"
                    value={draft.endDate}
                  />
                </label>
              )}
              <label>
                <span>場所</span>
                <Input
                  onChange={(e) => patch({ location: e.target.value })}
                  placeholder="駅前歯科"
                  value={draft.location}
                />
              </label>
              <label>
                <span>メモ</span>
                <Textarea
                  onChange={(e) => patch({ note: e.target.value })}
                  placeholder="持ち物や連絡事項"
                  rows={3}
                  value={draft.note}
                />
              </label>
              <div className="detail-option">
                <p>繰り返し</p>
                <div className="option-rail">
                  {RECURRENCE_OPTIONS.map((option) => (
                    <Button
                      aria-pressed={recurrencePressed(option.kind, draft.recurrence)}
                      key={option.kind}
                      onClick={() =>
                        patch({ recurrence: recurrenceFor(option.kind, draft.startDate) })
                      }
                    >
                      {option.label}
                    </Button>
                  ))}
                  {draft.recurrence.kind === 'custom' && (
                    <Button aria-pressed disabled>
                      {draft.recurrence.label}
                    </Button>
                  )}
                </div>
              </div>
              {draft.recurrence.kind !== 'none' && (
                <div className="detail-option">
                  <p>繰り返しの終わり</p>
                  <div className="option-rail">
                    {endOptions(draft.startDate).map((option) => (
                      <Button
                        aria-pressed={sameEnd(draft.recurrenceEnd, option.value)}
                        key={option.label}
                        onClick={() => patch({ recurrenceEnd: option.value })}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <div className="detail-option">
                <p>自分への通知</p>
                <div className="option-rail">
                  <Button
                    aria-pressed={draft.myReminders.length === 0}
                    onClick={() => patch({ myReminders: [] })}
                  >
                    なし
                  </Button>
                  {reminderOptions.map((offset) => (
                    <Button
                      aria-pressed={draft.myReminders.includes(offset)}
                      key={offset}
                      onClick={() =>
                        patch({
                          myReminders: draft.myReminders.includes(offset)
                            ? draft.myReminders.filter((x) => x !== offset)
                            : [...draft.myReminders, offset].slice(-3),
                        })
                      }
                    >
                      {reminderLabel(offset, draft.allDay)}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="binary-options">
                <Button
                  aria-pressed={draft.isPrivate}
                  onClick={() => patch({ isPrivate: !draft.isPrivate })}
                >
                  非公開　{draft.isPrivate ? 'オン' : 'オフ'}
                </Button>
                <Button aria-pressed={draft.busy} onClick={() => patch({ busy: !draft.busy })}>
                  空き時間に含める　{draft.busy ? 'オン' : 'オフ'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <footer className="full-sheet-footer">
          {!online && <p>オフラインです。保存後、接続時に送信します。</p>}
          <Button disabled={!canSave} onClick={onSave} variant="accent">
            {vm.saveLabel}
          </Button>
        </footer>
        {picker && (
          <div className="subsheet-backdrop">
            <section
              aria-label={picker === 'date' ? '日付を選ぶ' : '時刻を選ぶ'}
              aria-modal="true"
              className="bottom-sheet composer-picker"
              role="dialog"
            >
              <div className="sheet-title">
                <strong>{picker === 'date' ? '日付を選ぶ' : '時刻を選ぶ'}</strong>
                <Button onClick={() => setPicker(null)}>閉じる</Button>
              </div>
              {picker === 'date' ? (
                <label className="composer-picker-other">
                  <span>ほかの日</span>
                  <Input
                    max={latest}
                    min={earliest}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      patch({ startDate: e.target.value });
                      setPicker(null);
                    }}
                    type="date"
                    value={draft?.startDate ?? ''}
                  />
                </label>
              ) : (
                <label className="composer-picker-other">
                  <span>ほかの時刻</span>
                  <Input
                    onChange={(e) => {
                      if (!e.target.value) return;
                      patch({ allDay: false, startTime: e.target.value });
                    }}
                    type="time"
                    value={draft?.startTime ?? ''}
                  />
                </label>
              )}
              <div className="composer-picker-grid">
                {picker === 'date'
                  ? pickerDates.map((date) => {
                      const { month, day } = parseDate(date);
                      return (
                        <Button
                          key={date}
                          onClick={() => {
                            patch({ startDate: date });
                            setPicker(null);
                          }}
                        >
                          {month}/{day}({WEEKDAY_LABELS[weekdayOf(date)]})
                        </Button>
                      );
                    })
                  : pickerTimes.map((time) => (
                      <Button
                        key={time}
                        onClick={() => {
                          patch({ allDay: false, startTime: time });
                          setPicker(null);
                        }}
                      >
                        {shortTime(time)}
                      </Button>
                    ))}
              </div>
            </section>
          </div>
        )}
        {children}
      </section>
    </div>
  );
}
