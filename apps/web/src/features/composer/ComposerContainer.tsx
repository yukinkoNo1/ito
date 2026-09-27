import { useEffect, useState } from 'react';
import { useData, useEvents, useSyncState } from '../../app/data-context';
import { useMemberVMs } from '../../app/hooks';
import { useNav } from '../../app/nav';
import { useToast } from '../../app/toast';
import { useVmContext } from '../../app/use-vm';
import EventComposerSheet from '../../ui/sheets/EventComposerSheet';
import type { ComposerVM, EventDraftVM } from '../../ui/types';
import { applyDraftPatch } from '../../viewmodels/composer';
import { buildComposerVM } from '../../viewmodels/composer-vm';
import { draftToInput, emptyDraft, eventToDraft } from '../../viewmodels/detail';

interface ComposerState {
  /** どの開き方で作った下書きか（開き方が変わったら作り直す） */
  key: string;
  text: string;
  draft: EventDraftVM;
  mode: ComposerVM['mode'];
  busyTouched: boolean;
  saving: boolean;
  error: string | null;
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

  useEffect(() => {
    if (!key || !today || !meId) {
      setState(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const source = sourceId ? await db.events.get(sourceId) : undefined;
      if (cancelled) return;
      const draft = source
        ? eventToDraft(source)
        : { ...emptyDraft(date ?? today, meId, time), title: text ?? '' };
      setState({
        key,
        text: draft.title,
        draft,
        mode: more ? 'detail' : 'quick',
        busyTouched: Boolean(source),
        saving: false,
        error: null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [key, sourceId, date, time, text, more, db, today, meId]);

  if (!params || !state || state.key !== key || !ctx) return null;
  const editId = params.editId;

  const vm = buildComposerVM({
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

  const save = async () => {
    setState((s) => (s ? { ...s, saving: true, error: null } : s));
    const input = draftToInput(state.draft);
    const fail = (message: string) =>
      setState((s) => (s ? { ...s, saving: false, error: message } : s));
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

  return (
    <EventComposerSheet
      members={members}
      onChangeDraft={change}
      onChooseAmbiguity={() => {}}
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
    />
  );
}
