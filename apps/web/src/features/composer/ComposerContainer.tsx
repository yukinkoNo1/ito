import { useEffect, useState } from 'react';
import { useData, useEvents, useSyncState } from '../../app/data-context';
import { useMemberVMs, useOffline } from '../../app/hooks';
import { useNav } from '../../app/nav';
import { useToast } from '../../app/toast';
import { useVmContext } from '../../app/use-vm';
import type { LocalEvent } from '../../data/db';
import EventComposerSheet from '../../ui/sheets/EventComposerSheet';
import { RecurrenceScopeDialog } from '../../ui/sheets/EventDetailSheet';
import type { ComposerVM, EventDraftVM } from '../../ui/types';
import { applyDraftPatch } from '../../viewmodels/composer';
import { buildComposerVM, monthEndQuestion } from '../../viewmodels/composer-vm';
import { draftToInput, emptyDraft, eventToDraft } from '../../viewmodels/detail';
import {
  changesForScope,
  changesStart,
  lostCounts,
  occurrenceEvent,
  type Scope,
} from '../../viewmodels/series';

interface ComposerState {
  /** どの開き方で作った下書きか（開き方が変わったら作り直す） */
  key: string;
  text: string;
  draft: EventDraftVM;
  mode: ComposerVM['mode'];
  busyTouched: boolean;
  saving: boolean;
  error: string | null;
  /** 繰り返しの回を直すとき、元の回の中身（C-04 の件数と、開始が変わるかの判定に使う） */
  base: LocalEvent | null;
  /** 29〜31 日の毎月に「月末にしますか？」と聞いた答え（0＝そのまま、1＝月末） */
  monthEnd: number | null;
  /** 保存のときに C-04 で範囲を聞いている */
  askScope: boolean;
}

/**
 * S-05 予定を書く。入力バー・日の見出しの「＋」・月の日・詳細の「編集」「複製」から開く（`?compose=1`）。
 * 一言の解析（F-22 の曖昧さ・重なり）は Phase 5 でつなぐ。それまでは一言をそのまま件名にする
 */
export function ComposerContainer() {
  const nav = useNav();
  const params = nav.composer;
  const { db, store } = useData();
  const ctx = useVmContext();
  const events = useEvents();
  const members = useMemberVMs();
  const toast = useToast();
  const sync = useSyncState();
  const offline = useOffline();
  const [state, setState] = useState<ComposerState | null>(null);
  const key = params ? JSON.stringify(params) : null;
  // ctx は毎分変わるので、開いたとき・開き方が変わったときだけ下書きを作る（今日と自分の ID だけを見る）
  const today = ctx?.today ?? null;
  const meId = ctx?.meId ?? null;
  const sourceId = params?.editId ?? params?.duplicateId ?? null;
  const date = params?.date ?? null;
  const time = params?.time ?? null;
  const text = params?.text ?? null;
  const more = params?.more ?? false;
  const rid = params?.rid ?? null;

  useEffect(() => {
    if (!key || !today || !meId) {
      setState(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const source = sourceId ? await db.events.get(sourceId) : undefined;
      // 繰り返しの回を直すとき: その回の今の中身（例外行、なければ親をその回に置いたもの）に、親の繰り返しを付ける
      const overrides =
        source && rid ? await db.events.where('parentId').equals(source.id).toArray() : [];
      if (cancelled) return;
      const base = source && rid ? occurrenceEvent(source, overrides, rid) : null;
      const draft = source
        ? base
          ? { ...eventToDraft(base), ...recurrenceDraft(source) }
          : eventToDraft(source)
        : { ...emptyDraft(date ?? today, meId, time), title: text ?? '' };
      setState({
        key,
        text: draft.title,
        draft,
        mode: more ? 'detail' : 'quick',
        busyTouched: Boolean(source),
        saving: false,
        error: null,
        base,
        monthEnd: null,
        askScope: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [key, sourceId, date, time, text, more, rid, db, today, meId]);

  if (!params || !state || state.key !== key || !ctx) return null;
  const editId = params.editId;

  const built = buildComposerVM({
    mode: state.mode,
    editing: Boolean(editId),
    text: state.text,
    draft: state.draft,
    today: ctx.today,
    nowMs: ctx.nowMs,
    events: events ?? [],
    members,
    saving: state.saving,
    error: state.error,
  });
  // 29〜31 日の毎月は「月末にしますか？」（31 日のない月などはとばされるため。§11）
  const monthEnd = monthEndQuestion(state.draft, state.monthEnd);
  const vm = monthEnd ? { ...built, ambiguities: [...built.ambiguities, monthEnd] } : built;

  const change = (patch: Partial<EventDraftVM>) => {
    setState((s) => {
      if (!s) return s;
      const busyTouched = s.busyTouched || patch.busy !== undefined;
      const draft = applyDraftPatch(s.draft, patch, { busyTouched });
      return {
        ...s,
        draft,
        busyTouched,
        text: patch.title !== undefined ? patch.title : s.text,
        error: null,
      };
    });
  };

  const master = editId ? (events ?? []).find((e) => e.id === editId) : undefined;
  const overrides = editId ? (events ?? []).filter((e) => e.parentId === editId) : [];
  const seriesRid = master?.rrule && params.rid && state.base ? params.rid : null;

  const fail = (message: string) =>
    setState((s) => (s ? { ...s, saving: false, error: message, askScope: false } : s));

  /** 繰り返しの回を、選んだ範囲で保存する（C-04） */
  const saveScope = async (scope: Scope) => {
    if (!editId || !master || !seriesRid) return;
    setState((s) => (s ? { ...s, saving: true, error: null, askScope: false } : s));
    const input = changesForScope(master, draftToInput(state.draft), scope);
    const r = await store.updateOccurrence(editId, seriesRid, scope, input);
    if (!r.ok) return fail(r.errors.map((e) => e.message).join('。'));
    nav.closeComposer();
    toast.show({
      kind: 'undo',
      message: '保存しました',
      actionLabel: r.undo ? '元に戻す' : null,
      onAction: () => void r.undo?.(),
    });
  };

  const save = async () => {
    // 繰り返しの回は、保存のときに範囲を選ぶ（C-04）
    if (seriesRid) {
      setState((s) => (s ? { ...s, askScope: true } : s));
      return;
    }
    setState((s) => (s ? { ...s, saving: true, error: null } : s));
    const input = draftToInput(state.draft);
    if (editId) {
      // 全部の項目を送る（手元で今の予定との差だけにする。サーバーは今の予定に当てて検証する）
      const r = await store.updateEvent(editId, input);
      if (!r.ok) return fail(r.errors.map((e) => e.message).join('。'));
      nav.closeComposer();
      toast.show({
        kind: 'undo',
        message: '保存しました',
        actionLabel: r.undo ? '元に戻す' : null,
        onAction: () => void r.undo?.(),
      });
      return;
    }
    const r = await store.createEvent(input);
    if (!r.ok) return fail(r.errors.map((e) => e.message).join('。'));
    nav.closeComposer();
    toast.show({
      kind: 'undo',
      message: '保存しました',
      actionLabel: '元に戻す',
      onAction: () => void store.deleteEvent(r.value.id),
    });
  };

  const lost =
    master && seriesRid && state.base
      ? lostCounts(master, overrides, seriesRid, {
          action: 'edit',
          startsChange: changesStart(state.base, draftToInput(state.draft)),
        })
      : { following: 0, all: 0 };

  return (
    <EventComposerSheet
      members={members}
      onChangeDraft={change}
      onChooseAmbiguity={(ai, oi) => {
        const a = vm.ambiguities[ai];
        const option = a?.options[oi];
        if (!a || !option) return;
        // 今つないでいる曖昧さは「月末にしますか？」だけ（一言の解析の曖昧さは Phase 5）
        if (a.field === 'recurrence') setState((s) => (s ? { ...s, monthEnd: oi } : s));
        change(option.patch);
      }}
      onClose={nav.closeComposer}
      onPickSuggestion={(index) => {
        const s = vm.suggestions[index];
        if (s) change(s.patch);
      }}
      onSave={() => void save()}
      onSetMode={(mode) => setState((s) => (s ? { ...s, mode } : s))}
      onSubmitText={() => {}}
      onTextChange={(text) => change({ title: text })}
      online={sync.status !== 'offline'}
      open
      vm={vm}
    >
      <RecurrenceScopeDialog
        action="edit"
        lost={lost}
        offline={offline}
        onCancel={() => setState((s) => (s ? { ...s, askScope: false } : s))}
        onChoose={(scope) => void saveScope(scope)}
        open={state.askScope}
      />
    </EventComposerSheet>
  );
}

/** 親の繰り返しを書く画面の形に（回の中身には繰り返しがないため） */
function recurrenceDraft(master: LocalEvent): Pick<EventDraftVM, 'recurrence' | 'recurrenceEnd'> {
  const d = eventToDraft(master);
  return { recurrence: d.recurrence, recurrenceEnd: d.recurrenceEnd };
}
