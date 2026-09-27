import { isValidDate } from '@ito/core';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useData, useMe } from '../../app/data-context';
import { useToast } from '../../app/toast';
import { useVmContext } from '../../app/use-vm';
import type { EventDraftVM } from '../../ui/types';
import { applyDraftPatch } from '../../viewmodels/composer';
import { draftToInput, emptyDraft, eventToDraft } from '../../viewmodels/detail';
import { toMemberVMs } from '../../viewmodels/occurrence';

/** S-05 予定を書く（詳しく入力。素朴な HTML。Phase 5・6 で一言入力と本番の UI に差し替える） */
export function ComposerOverlay() {
  const [params, setParams] = useSearchParams();
  const open = params.get('compose') === '1';
  const editId = params.get('edit');
  const duplicateId = params.get('duplicate');
  const dateParam = params.get('date');
  const { db, store } = useData();
  const me = useMe();
  const ctx = useVmContext();
  const toast = useToast();
  const [draft, setDraft] = useState<EventDraftVM | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busyTouched, setBusyTouched] = useState(false);
  // ctx は毎分変わるので、開いたとき・対象が変わったときだけ下書きを作る（今日と自分の ID だけを見る）
  const today = ctx?.today ?? null;
  const meId = ctx?.meId ?? null;

  useEffect(() => {
    if (!open || !today || !meId) {
      setDraft(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const sourceId = editId ?? duplicateId;
      const source = sourceId ? await db.events.get(sourceId) : undefined;
      if (cancelled) return;
      const date = dateParam && isValidDate(dateParam) ? dateParam : today;
      setDraft(source ? eventToDraft(source) : emptyDraft(date, meId));
      setBusyTouched(Boolean(source));
      setErrors([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editId, duplicateId, dateParam, db, today, meId]);

  if (!open || !draft || !ctx || !me) return null;
  const members = toMemberVMs(ctx.members, ctx.meId);
  const set = (patch: Partial<EventDraftVM>) => {
    if (patch.busy !== undefined) setBusyTouched(true);
    setDraft(
      applyDraftPatch(draft, patch, { busyTouched: busyTouched || patch.busy !== undefined }),
    );
  };

  const close = () => {
    const next = new URLSearchParams(params);
    for (const k of ['compose', 'edit', 'duplicate', 'date']) next.delete(k);
    setParams(next);
  };

  const save = async () => {
    const input = draftToInput(draft);
    if (editId) {
      // 詳しく入力は全部の項目を送る（サーバーは今の予定に当てて検証する）
      const changes = input;
      const r = await store.updateEvent(editId, changes);
      if (!r.ok) {
        setErrors(r.errors.map((e) => e.message));
        return;
      }
      toast.show({
        kind: 'undo',
        message: '保存しました',
        actionLabel: r.undo ? '元に戻す' : null,
        onAction: () => void r.undo?.(),
      });
    } else {
      const r = await store.createEvent(input);
      if (!r.ok) {
        setErrors(r.errors.map((e) => e.message));
        return;
      }
      toast.show({
        kind: 'undo',
        message: '保存しました',
        actionLabel: '元に戻す',
        onAction: () => void store.deleteEvent(r.value.id),
      });
    }
    close();
  };

  const canSave = draft.title.trim().length > 0 && isValidDate(draft.startDate);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="予定を書く"
      className="fixed inset-0 z-10 overflow-y-auto bg-white p-3"
    >
      <form
        className="mx-auto flex max-w-[480px] flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="text-lg">{editId ? '予定を直す' : '予定を書く'}</h2>
        <label className="flex flex-col">
          件名
          <input
            className="min-h-11 border px-2 text-base"
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={draft.allDay}
            onChange={(e) =>
              set({
                allDay: e.target.checked,
              })
            }
          />
          終日
        </label>
        <label className="flex flex-col">
          日付
          <input
            type="date"
            className="min-h-11 border px-2 text-base"
            value={draft.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
          />
        </label>
        {draft.allDay ? (
          <label className="flex flex-col">
            最終日
            <input
              type="date"
              className="min-h-11 border px-2 text-base"
              value={draft.endDate}
              onChange={(e) => set({ endDate: e.target.value })}
            />
          </label>
        ) : (
          <>
            <label className="flex flex-col">
              開始
              <input
                type="time"
                className="min-h-11 border px-2 text-base"
                value={draft.startTime ?? ''}
                onChange={(e) => set({ startTime: e.target.value || null })}
              />
            </label>
            <label className="flex flex-col">
              終了
              <input
                type="time"
                className="min-h-11 border px-2 text-base"
                value={draft.endTime ?? ''}
                onChange={(e) => set({ endTime: e.target.value || null })}
              />
            </label>
          </>
        )}
        <fieldset>
          <legend>人</legend>
          <label className="mr-3 inline-flex min-h-11 items-center gap-1">
            <input
              type="checkbox"
              checked={draft.forEveryone}
              disabled={draft.isPrivate}
              onChange={(e) => set({ forEveryone: e.target.checked })}
            />
            全員
          </label>
          {members.map((m) => (
            <label key={m.id} className="mr-3 inline-flex min-h-11 items-center gap-1">
              <input
                type="checkbox"
                checked={draft.memberIds.includes(m.id)}
                disabled={draft.forEveryone || draft.isPrivate}
                onChange={(e) =>
                  set({
                    memberIds: e.target.checked
                      ? [...draft.memberIds, m.id]
                      : draft.memberIds.filter((id) => id !== m.id),
                  })
                }
              />
              {m.name}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col">
          場所
          <input
            className="min-h-11 border px-2 text-base"
            value={draft.location}
            onChange={(e) => set({ location: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          メモ
          <textarea
            className="border px-2 text-base"
            value={draft.note}
            onChange={(e) => set({ note: e.target.value })}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={draft.isPrivate}
            onChange={(e) =>
              set({ isPrivate: e.target.checked, forEveryone: false, memberIds: [me.id] })
            }
          />
          内緒（自分だけ）
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={draft.busy}
            onChange={(e) => set({ busy: e.target.checked })}
          />
          空き時間で「予定あり」にする
        </label>
        {errors.length > 0 && (
          <ul role="alert" className="text-red-700">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <button type="button" className="min-h-11 px-3" onClick={close}>
            閉じる
          </button>
          <button type="submit" className="min-h-11 flex-1 px-3 font-bold" disabled={!canSave}>
            {canSave ? '保存' : '件名を入れてください'}
          </button>
        </div>
      </form>
    </div>
  );
}
