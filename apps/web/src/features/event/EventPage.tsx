import { addDays, expand, fromJst, type Occurrence } from '@ito/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useData, useMembers } from '../../app/data-context';
import { useToast } from '../../app/toast';
import { useVmContext } from '../../app/use-vm';
import type { LocalEvent } from '../../data/db';
import { buildDetail } from '../../viewmodels/detail';
import { toMemberVMs } from '../../viewmodels/occurrence';

/** 予定の回を探す（繰り返しは Phase 3 で recurrenceId の回を展開する） */
export function findOccurrence(
  event: LocalEvent,
  overrides: LocalEvent[],
  recurrenceId: string | null,
): Occurrence<LocalEvent> | null {
  const from = fromJst('1970-01-01');
  const to = fromJst(addDays('2100-12-31', 1));
  const all = expand(event, overrides, from, to);
  if (recurrenceId) return all.find((o) => o.recurrenceId === recurrenceId) ?? null;
  return all[0] ?? null;
}

/** S-04 予定の詳細（素朴な HTML。Phase 6 で下から出るシートに差し替える） */
export function EventPage() {
  const { eventId } = useParams();
  const [params, setParams] = useSearchParams();
  const recurrenceId = params.get('r');
  const { db, store } = useData();
  const ctx = useVmContext();
  const allMembers = useMembers();
  const navigate = useNavigate();
  const toast = useToast();
  const data = useLiveQuery(async () => {
    if (!eventId) return null;
    const event = await db.events.get(eventId);
    if (!event) return null;
    const overrides = await db.events.where('parentId').equals(eventId).toArray();
    const conflict = await db.conflicts.get(eventId);
    return { event, overrides, conflict };
  }, [db, eventId]);

  if (data === undefined || !ctx) return <p>読み込み中…</p>;
  if (data === null) return <p>この予定は見つかりません（削除されたかもしれません）</p>;
  const occ = findOccurrence(data.event, data.overrides, recurrenceId);
  if (!occ) return <p>この予定は見つかりません</p>;
  const vm = buildDetail(occ, ctx, allMembers);
  const members = toMemberVMs(ctx.members, ctx.meId);
  const names = vm.occ.forEveryone
    ? '全員'
    : vm.occ.memberIds.map((id) => members.find((m) => m.id === id)?.name ?? '？').join('・');

  const openComposer = (mode: 'edit' | 'duplicate') => {
    const next = new URLSearchParams(params);
    next.set('compose', '1');
    next.set(mode, occ.seriesId);
    setParams(next);
  };

  const remove = async () => {
    const { ok, undo } = await store.deleteEvent(occ.seriesId);
    if (!ok) return;
    toast.show({
      kind: 'undo',
      message: '予定を削除しました',
      actionLabel: '元に戻す',
      onAction: () => void undo(),
    });
    navigate(-1);
  };

  return (
    <article aria-label="予定の詳細">
      <h1 className="text-xl">{vm.occ.title ?? '予定あり'}</h1>
      <dl>
        <dt>日付</dt>
        <dd>{vm.dateLabel}</dd>
        <dt>時刻</dt>
        <dd>{vm.timeLabel ?? '終日'}</dd>
        <dt>人</dt>
        <dd>{names}</dd>
        {vm.occ.location && (
          <>
            <dt>場所</dt>
            <dd>{vm.occ.location}</dd>
          </>
        )}
        {vm.occ.note && (
          <>
            <dt>メモ</dt>
            <dd className="whitespace-pre-wrap">{vm.occ.note}</dd>
          </>
        )}
        {vm.occ.isPrivate && (
          <>
            <dt>公開</dt>
            <dd>内緒（自分だけ）</dd>
          </>
        )}
      </dl>
      <p className="text-sm">作成 {vm.createdByName}</p>
      {vm.updatedLabel && <p className="text-sm">{vm.updatedLabel}</p>}
      {data.conflict && (
        <section aria-label="競合の解決">
          <p>家族の変更と重なりました</p>
          <button
            type="button"
            className="min-h-11 px-3"
            onClick={() => void store.resolveConflict(occ.seriesId, 'theirs')}
          >
            家族の変更を採用
          </button>
          <button
            type="button"
            className="min-h-11 px-3"
            onClick={() => void store.resolveConflict(occ.seriesId, 'mine')}
          >
            自分の変更で上書き
          </button>
          <button
            type="button"
            className="min-h-11 px-3"
            onClick={() => void store.resolveConflict(occ.seriesId, 'both')}
          >
            両方残す
          </button>
        </section>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" className="min-h-11 px-3" onClick={() => navigate(-1)}>
          閉じる
        </button>
        {vm.canEdit && !data.conflict && (
          <>
            <button type="button" className="min-h-11 px-3" onClick={() => openComposer('edit')}>
              編集
            </button>
            <button
              type="button"
              className="min-h-11 px-3"
              onClick={() => openComposer('duplicate')}
            >
              複製
            </button>
            <button type="button" className="min-h-11 px-3" onClick={() => void remove()}>
              削除
            </button>
          </>
        )}
      </div>
    </article>
  );
}
