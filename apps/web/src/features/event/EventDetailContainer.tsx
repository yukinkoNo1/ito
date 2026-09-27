import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useData, useMembers } from '../../app/data-context';
import { useMemberVMs, useOffline } from '../../app/hooks';
import { mapUrl } from '../../app/maps';
import { useNav } from '../../app/nav';
import { useToast } from '../../app/toast';
import { useVmContext } from '../../app/use-vm';
import { CONFLICT_FIRST } from '../../data/store';
import { detectPlatform } from '../../pwa/install';
import { Button } from '../../ui/primitives/Controls';
import EventDetailSheet, {
  ConflictSheet,
  FieldEditSheet,
  RecurrenceScopeDialog,
} from '../../ui/sheets/EventDetailSheet';
import type { EventDraftVM } from '../../ui/types';
import { applyDraftPatch } from '../../viewmodels/composer';
import { QUICK_TIMES, quickDates, saveLabelFor } from '../../viewmodels/composer-vm';
import { buildDetail, draftToInput, eventToDraft, findOccurrence } from '../../viewmodels/detail';
import { toOccurrenceVM } from '../../viewmodels/occurrence';
import {
  lostCounts,
  occurrenceChanges,
  occurrenceEvent,
  type Scope,
  thisScopeBlock,
} from '../../viewmodels/series';

/** S-04 予定の詳細（下から出るシート）。その項目だけ直す（FieldEditSheet）・C-05 競合の解決を中に重ねる */
export function EventDetailContainer() {
  const nav = useNav();
  const target = nav.detail;
  const { db, store } = useData();
  const ctx = useVmContext();
  const allMembers = useMembers();
  const members = useMemberVMs();
  const toast = useToast();
  // 中に重ねるシートは、開いた予定の ID ごとに持つ（別の予定を開いたら閉じている）
  const [fieldState, setField] = useState<{
    eventId: string;
    kind: 'date' | 'members';
    draft: EventDraftVM;
  } | null>(null);
  const [conflictFor, setConflictFor] = useState<string | null>(null);
  // 繰り返しの回の範囲を聞いている（C-04）。選んだら run を呼ぶ
  const [scopeState, setScope] = useState<{
    eventId: string;
    action: 'edit' | 'delete';
    lost: { following: number; all: number };
    thisBlocked: string | null;
    run: (scope: Scope) => Promise<void>;
  } | null>(null);
  const eventId = target?.eventId ?? null;
  const field = fieldState && fieldState.eventId === eventId ? fieldState : null;
  const conflictOpen = conflictFor !== null && conflictFor === eventId;
  const setConflictOpen = (open: boolean) => setConflictFor(open ? eventId : null);
  const scope = scopeState && scopeState.eventId === eventId ? scopeState : null;
  const offline = useOffline();

  const data = useLiveQuery(async () => {
    if (!eventId) return null;
    const event = await db.events.get(eventId);
    if (!event) return null;
    const overrides = await db.events.where('parentId').equals(eventId).toArray();
    const conflict = (await db.conflicts.get(eventId)) ?? null;
    return { event, overrides, conflict };
  }, [db, eventId]);

  if (!target || !ctx || data === undefined) return null;
  const occ = data ? findOccurrence(data.event, data.overrides, target.recurrenceId) : null;
  if (!data || !occ) {
    return (
      <div className="sheet-backdrop">
        <section aria-label="予定の詳細" aria-modal="true" className="bottom-sheet" role="dialog">
          <div className="sheet-title">
            <strong>この予定は見つかりません</strong>
            <Button onClick={nav.closeEvent}>閉じる</Button>
          </div>
          <p className="detail-meta">削除されたかもしれません。</p>
        </section>
      </div>
    );
  }

  const seriesId = occ.seriesId;
  const conflict = data.conflict;
  // 競合中は解決するまで編集・複製・削除を出さない（自分の変更が黙って消えないように。§24 D28）
  const built = buildDetail(occ, ctx, allMembers);
  const detail = conflict ? { ...built, canEdit: false } : built;

  // 繰り返しの回（§11）: 編集・削除のたびに範囲を選ぶ（C-04）
  const rid = occ.recurrenceId;
  const isSeries = rid !== null && data.event.rrule !== null;
  const occEvent = isSeries ? occurrenceEvent(data.event, data.overrides, rid) : null;

  const openField = (kind: 'date' | 'members') =>
    setField({ eventId: seriesId, kind, draft: eventToDraft(occEvent ?? occ.event) });

  const saveFieldScope = async (fieldDraftToSave: EventDraftVM, scopeChoice: Scope) => {
    if (!rid) return;
    // 項目だけを直すときは繰り返しを変えない（送るのは回の今の中身との差分だけ。store が取る）
    const { rrule: _rrule, ...input } = draftToInput(fieldDraftToSave);
    const r = await store.updateOccurrence(seriesId, rid, scopeChoice, input);
    if (!r.ok) {
      toast.show({
        kind: 'error',
        message: r.errors.map((e) => e.message).join('。'),
        actionLabel: null,
      });
      return;
    }
    setField(null);
    setScope(null);
    // 日時を動かした・「これ以降」で新しいシリーズにしたら、詳細をその回に移す（レビュー P3-web-09）
    const t = r.target;
    if (t && (t.eventId !== seriesId || t.recurrenceId !== rid)) {
      nav.replaceEvent(`${t.eventId}@${t.recurrenceId}`);
    }
    toast.show({
      kind: 'undo',
      message: '保存しました',
      actionLabel: r.undo ? '元に戻す' : null,
      onAction: () => void r.undo?.(),
    });
  };

  const saveField = async () => {
    if (!field) return;
    if (isSeries && rid && occEvent) {
      const draftToSave = field.draft;
      const { rrule: _rrule, ...input } = draftToInput(draftToSave);
      const diff = occurrenceChanges(data.event, occEvent, input, 'all');
      setScope({
        eventId: seriesId,
        action: 'edit',
        lost: lostCounts(data.event, data.overrides, rid, {
          action: 'edit',
          changes: diff.ok ? diff.changes : {},
        }),
        thisBlocked: thisScopeBlock(data.event, input),
        run: (choice) => saveFieldScope(draftToSave, choice),
      });
      return;
    }
    const r = await store.updateEvent(seriesId, draftToInput(field.draft));
    if (!r.ok) {
      toast.show({
        kind: 'error',
        message: r.errors.map((e) => e.message).join('。'),
        actionLabel: null,
      });
      return;
    }
    setField(null);
    toast.show({
      kind: 'undo',
      message: '保存しました',
      actionLabel: r.undo ? '元に戻す' : null,
      onAction: () => void r.undo?.(),
    });
  };

  const removeWith = async (scopeChoice: Scope | null) => {
    const { ok, undo } =
      scopeChoice && rid
        ? await store.deleteOccurrence(seriesId, rid, scopeChoice)
        : await store.deleteEvent(seriesId);
    if (!ok) {
      toast.show({ kind: 'error', message: CONFLICT_FIRST, actionLabel: null });
      return;
    }
    setScope(null);
    nav.closeEvent();
    toast.show({
      kind: 'undo',
      message: '予定を削除しました',
      actionLabel: undo ? '元に戻す' : null,
      onAction: () => void undo?.(),
    });
  };

  const remove = () => {
    if (!isSeries || !rid) return void removeWith(null);
    setScope({
      eventId: seriesId,
      action: 'delete',
      lost: lostCounts(data.event, data.overrides, rid, { action: 'delete' }),
      thisBlocked: null,
      run: (choice) => removeWith(choice),
    });
  };

  const resolve = async (choice: 'theirs' | 'mine' | 'both') => {
    await store.resolveConflict(seriesId, choice);
    setConflictOpen(false);
  };

  const conflictVMs = (() => {
    if (!conflict) return null;
    const theirs = findOccurrence({ ...conflict.theirs, sync: 'synced' }, [], target.recurrenceId);
    const mine = conflict.mine ? findOccurrence(conflict.mine, [], target.recurrenceId) : theirs;
    if (!theirs || !mine) return null;
    return {
      mine: toOccurrenceVM(mine, ctx),
      theirs: toOccurrenceVM(theirs, ctx),
      theirsByName: allMembers.find((m) => m.id === conflict.theirs.updatedBy)?.name ?? '家族',
      deleted: conflict.theirsDeleted
        ? ('theirs' as const)
        : conflict.kind === 'delete' || !conflict.mine
          ? ('mine' as const)
          : null,
    };
  })();

  const fieldDraft = field?.draft ?? eventToDraft(occ.event);

  return (
    <EventDetailSheet
      detail={detail}
      members={members}
      onChangeReminders={() => {}}
      onClose={nav.closeEvent}
      onDelete={remove}
      onDuplicate={() => nav.openComposer({ duplicate: seriesId })}
      onEdit={() => nav.openComposer({ edit: seriesId, ...(isSeries && rid ? { rid } : {}) })}
      onEditField={(f) => {
        if (f === 'date' || f === 'time') openField('date');
        else if (f === 'members') openField('members');
        else
          nav.openComposer({
            edit: seriesId,
            more: f !== 'title',
            ...(isSeries && rid ? { rid } : {}),
          });
      }}
      onOpenMap={(query) => {
        window.open(mapUrl(query, detectPlatform()), '_blank', 'noopener,noreferrer');
      }}
      onResolveConflict={() => setConflictOpen(true)}
    >
      <FieldEditSheet
        canSave={Boolean(fieldDraft.title.trim()) && !conflict}
        draft={fieldDraft}
        field={field?.kind ?? 'date'}
        members={members}
        onChangeDraft={(patch) =>
          setField((f) =>
            f ? { ...f, draft: applyDraftPatch(f.draft, patch, { busyTouched: true }) } : f,
          )
        }
        onClose={() => setField(null)}
        onSave={() => void saveField()}
        open={field !== null}
        quickDates={quickDates(ctx.today)}
        quickTimes={QUICK_TIMES}
        saveLabel={saveLabelFor(fieldDraft, true)}
      />
      {conflictVMs && (
        <ConflictSheet
          members={members}
          mine={conflictVMs.mine}
          onClose={() => setConflictOpen(false)}
          onKeepBoth={() => void resolve('both')}
          onKeepMine={() => void resolve('mine')}
          onKeepTheirs={() => void resolve('theirs')}
          open={conflictOpen}
          deleted={conflictVMs.deleted}
          theirs={conflictVMs.theirs}
          theirsByName={conflictVMs.theirsByName}
        />
      )}
      <RecurrenceScopeDialog
        action={scope?.action ?? 'edit'}
        lost={scope?.lost ?? { following: 0, all: 0 }}
        offline={offline}
        thisBlocked={scope?.thisBlocked ?? null}
        onCancel={() => setScope(null)}
        onChoose={(choice) => void scope?.run(choice)}
        open={scope !== null}
      />
    </EventDetailSheet>
  );
}
