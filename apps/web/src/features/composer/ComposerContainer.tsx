import type { MeDTO, ReminderPrefDTO } from '@ito/core';
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
import { draftDefaults, prefOf } from '../../viewmodels/reminders';
import {
  lostCounts,
  occurrenceChanges,
  occurrenceEvent,
  type Scope,
  thisScopeBlock,
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
  /** 自分への通知を触ったか。触っていなければ、担当・終日の変更に合わせて既定値に追従する */
  remindersTouched: boolean;
  /** 開いたときの本人の通知の行（直すときだけ。なければ既定値に追従） */
  reminderPref: number[] | undefined;
  /** 本人の既定値（§15 の設定） */
  reminderDefaults: { timedDefaults: number[]; allDayDefaults: number[] };
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
  const editing = Boolean(params?.editId);
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
      const me = await db.getMeta<MeDTO>('me');
      const prefs = await db.getMeta<ReminderPrefDTO[]>('myReminderPrefs');
      // 繰り返しの回を直すとき: その回の今の中身（例外行、なければ親をその回に置いたもの）に、親の繰り返しを付ける
      const overrides =
        source && rid ? await db.events.where('parentId').equals(source.id).toArray() : [];
      if (cancelled) return;
      const base = source && rid ? occurrenceEvent(source, overrides, rid) : null;
      const made = source
        ? base
          ? { ...eventToDraft(base), ...recurrenceDraft(source) }
          : eventToDraft(source)
        : { ...emptyDraft(date ?? today, meId, time), title: text ?? '' };
      // 自分への通知: 直すときは本人の行（なければ既定値）、書く・複製は既定値（§15）
      const reminderDefaults = me?.settings.notifications ?? {
        timedDefaults: [],
        allDayDefaults: [],
      };
      const reminderPref = editing && source ? prefOf(prefs, source.id) : undefined;
      const draft = {
        ...made,
        myReminders: reminderPref ?? draftDefaults(made, meId, reminderDefaults),
      };
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
        remindersTouched: false,
        reminderPref,
        reminderDefaults,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [key, sourceId, editing, date, time, text, more, rid, db, today, meId]);

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
      const remindersTouched = s.remindersTouched || patch.myReminders !== undefined;
      const patched = applyDraftPatch(s.draft, patch, { busyTouched });
      // 触っていなければ、終日・担当の変更に合わせて既定値に追従する
      const draft = remindersTouched
        ? patched
        : {
            ...patched,
            myReminders: s.reminderPref ?? draftDefaults(patched, meId ?? '', s.reminderDefaults),
          };
      return {
        ...s,
        draft,
        busyTouched,
        remindersTouched,
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
    // 送るのは回の今の中身との差分だけ（日時は変えたときだけ。store が取る。§24 D34）
    const r = await store.updateOccurrence(editId, seriesRid, scope, draftToInput(state.draft));
    if (!r.ok) return fail(r.errors.map((e) => e.message).join('。'));
    const t = r.target;
    // 自分への通知は、保存したあとのシリーズに（「これ以降」なら新しいシリーズ）
    if (state.remindersTouched) {
      void store.setMyReminders(t?.eventId ?? editId, state.draft.myReminders);
    }
    // 下に詳細が開いていて、保存で回が変わったら（日時を動かした・「これ以降」）、詳細をその回に移す
    if (nav.detail && t && (t.eventId !== editId || t.recurrenceId !== seriesRid)) {
      nav.replaceEvent(`${t.eventId}@${t.recurrenceId}`);
    } else {
      nav.closeComposer();
    }
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
      if (state.remindersTouched) void store.setMyReminders(editId, state.draft.myReminders);
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
    // 既定値のままなら行を作らない（既定値を変えたら新しい既定値に従う）
    if (state.remindersTouched) void store.setMyReminders(r.value.id, state.draft.myReminders);
    nav.closeComposer();
    toast.show({
      kind: 'undo',
      message: '保存しました',
      actionLabel: '元に戻す',
      onAction: () => void store.deleteEvent(r.value.id),
    });
  };

  const scopeInput = draftToInput(state.draft);
  const scopeDiff =
    master && state.base ? occurrenceChanges(master, state.base, scopeInput, 'all') : null;
  const lost =
    master && seriesRid && scopeDiff
      ? lostCounts(master, overrides, seriesRid, {
          action: 'edit',
          changes: scopeDiff.ok ? scopeDiff.changes : {},
        })
      : { following: 0, all: 0 };
  const thisBlocked = master ? thisScopeBlock(master, scopeInput) : null;

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
        thisBlocked={thisBlocked}
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
