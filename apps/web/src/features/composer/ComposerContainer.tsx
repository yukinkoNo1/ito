import type { MeDTO, ReminderPrefDTO } from '@ito/core';
import { useEffect, useState } from 'react';
import { useData, useEvents, useMe, useMembers, useSyncState } from '../../app/data-context';
import { useMemberVMs, useOffline } from '../../app/hooks';
import { useNav } from '../../app/nav';
import { useToast } from '../../app/toast';
import { useVmContext } from '../../app/use-vm';
import { apiRequest } from '../../data/api';
import type { LocalEvent } from '../../data/db';
import EventComposerSheet from '../../ui/sheets/EventComposerSheet';
import { RecurrenceScopeDialog } from '../../ui/sheets/EventDetailSheet';
import type { AmbiguityVM, ComposerVM, EventDraftVM } from '../../ui/types';
import { applyDraftPatch } from '../../viewmodels/composer';
import { buildComposerVM, monthEndQuestion } from '../../viewmodels/composer-vm';
import { draftToInput, emptyDraft, eventToDraft } from '../../viewmodels/detail';
import {
  applyTextPatch,
  forgetTextFields,
  nlpContext,
  nlpToPatch,
  overlapsFor,
  parseLocally,
  parseResponseSchema,
  protectTouched,
  toAmbiguityVM,
  visibleAmbiguities,
} from '../../viewmodels/nlp';
import {
  draftDefaults,
  followReminders,
  prefOf,
  type ReminderDraftState,
  shouldWriteReminders,
} from '../../viewmodels/reminders';
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
  /** 本人の行を付けた予定の種類（終日か）。切り替えたら行は使わず既定値に戻す */
  reminderPrefAllDay: boolean;
  /** 本人の既定値（§15 の設定） */
  reminderDefaults: { timedDefaults: number[]; allDayDefaults: number[] };
  /** 一言の解析（§16）: 確認へ進んだか・解析のもと（ai／かんたん解析）・曖昧さ */
  parse: ComposerVM['parse'];
  source: ComposerVM['source'];
  ambiguities: AmbiguityVM[];
  /** 札で選んだ項目（一言を書き直しても上書きしない） */
  touched: string[];
  /** 一言で入れた項目の、入れる前の値（一言からその語を消したら戻す） */
  textBefore: Partial<EventDraftVM>;
}

/** 一言の解析の待ち時間の上限（サーバーの AI は 6 秒。通信の分を足す） */
const PARSE_TIMEOUT_MS = 10_000;

/**
 * S-05 予定を書く。入力バー・日の見出しの「＋」・月の日・詳細の「編集」「複製」から開く（`?compose=1`）。
 * 一言は書いているあいだ端末のルール解析で札に反映し、「確認へ」（Enter）で POST /api/parse の結果に置き換えて、
 * 曖昧さの質問と重なりの警告を出す。オフライン・失敗のときはルール解析のまま（かんたん解析。§16）
 */
export function ComposerContainer() {
  const nav = useNav();
  const params = nav.composer;
  const { db, store, clock } = useData();
  const ctx = useVmContext();
  const events = useEvents();
  const members = useMemberVMs();
  const toast = useToast();
  const sync = useSyncState();
  const offline = useOffline();
  const me = useMe();
  const allMembers = useMembers();
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
      // 入力バーから一言を持って開いたら、ルール解析で札に反映する（§16）
      const members = await db.members.toArray();
      const parsed =
        !source && text && me ? parseLocally(text, nlpContext(me, members, clock.now())) : null;
      const applied = parsed
        ? applyTextPatch(made, nlpToPatch(parsed.draft, parsed.found, made), {})
        : { patch: {}, textBefore: {} };
      const withText = { ...made, ...applied.patch };
      // 本人の行はシリーズ・予定そのものの行なので、種類も回ではなくシリーズ・予定のもの。種類が違えば既定値
      const reminderPrefAllDay = source ? source.allDay : made.allDay;
      const draft = {
        ...withText,
        myReminders:
          (withText.allDay === reminderPrefAllDay ? reminderPref : undefined) ??
          draftDefaults(withText, meId, reminderDefaults),
      };
      setState({
        key,
        text: text ?? draft.title,
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
        reminderPrefAllDay,
        reminderDefaults,
        parse: 'idle',
        source: null,
        ambiguities: [],
        touched: [],
        textBefore: applied.textBefore,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [key, sourceId, editing, date, time, text, more, rid, db, today, meId, clock]);

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
  // 確認へ進んだら、曖昧さの質問と重なりの警告を出す（§16）
  const vm: ComposerVM = {
    ...built,
    parse: state.parse,
    source: state.source,
    ambiguities: [...state.ambiguities, ...(monthEnd ? [monthEnd] : [])],
    overlaps:
      state.parse === 'done'
        ? overlapsFor(state.draft, events ?? [], ctx.meId, editId ?? null)
        : [],
  };

  /**
   * 下書きを置き換え、自分への通知を追従させる（触っていなければ担当・終日の変更に合わせて既定値。
   * 終日⇔時刻ありの切り替えでは既定値に戻す。§24 D36）
   */
  const withReminders = (s: ComposerState, next: EventDraftVM, touchedNow = false) => {
    const followed = followReminders(
      s.draft,
      next,
      { ...reminderStateOf(s), touched: s.remindersTouched || touchedNow },
      meId ?? '',
    );
    return {
      draft: { ...next, myReminders: followed.myReminders },
      remindersTouched: followed.touched,
    };
  };

  const change = (patch: Partial<EventDraftVM>, opts: { touch?: boolean } = {}) => {
    setState((s) => {
      if (!s) return s;
      const touched = opts.touch ? [...new Set([...s.touched, ...Object.keys(patch)])] : s.touched;
      const busyTouched = s.busyTouched || patch.busy !== undefined;
      const patched = applyDraftPatch(s.draft, patch, { busyTouched });
      return {
        ...s,
        ...withReminders(s, patched, patch.myReminders !== undefined),
        // 札・候補で変えた項目は、一言で入れたものではなくなる
        textBefore: forgetTextFields(
          s.textBefore,
          Object.keys(patch).filter((k) => k !== 'title'),
        ),
        touched,
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
    // 送るのは回の今の中身との差分だけ（日時は変えたときだけ。store が取る。§24 D34）
    const r = await store.updateOccurrence(editId, seriesRid, scope, draftToInput(state.draft));
    if (!r.ok) return fail(r.errors.map((e) => e.message).join('。'));
    const t = r.target;
    // 自分への通知は、保存したあとのシリーズに（「これ以降」なら新しいシリーズ）。
    // 「この予定だけ」はシリーズの種類（終日か）が変わらないので、回だけ種類を変えた下書きの通知は書かない
    const reminders = writeReminders(t?.eventId ?? editId, scope === 'this' ? master.allDay : null);
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
      onAction: () => {
        void r.undo?.();
        void reminders.undo?.();
      },
    });
  };

  /**
   * 保存したあと、自分への通知の行を書く（触ったとき・行が違う種類になったとき）。targetAllDay は行を付ける予定の
   * 種類（null なら下書きと同じ）。元に戻すときは、前の本人の行に戻す
   */
  const writeReminders = (eventId: string, targetAllDay: boolean | null) => {
    const rs = reminderStateOf(state);
    if (!shouldWriteReminders(state.draft, rs, targetAllDay ?? state.draft.allDay)) return {};
    void store.setMyReminders(eventId, state.draft.myReminders);
    const before = rs.pref;
    return { undo: before ? () => store.setMyReminders(eventId, before) : undefined };
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
      const reminders = writeReminders(editId, null);
      nav.closeComposer();
      toast.show({
        kind: 'undo',
        message: '保存しました',
        actionLabel: r.undo ? '元に戻す' : null,
        onAction: () => {
          void r.undo?.();
          void reminders.undo?.();
        },
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
  /** 一言を書き直した: 直すときは件名だけ、書くときはルール解析で札に反映する（札で選んだ項目は残す） */
  const changeText = (value: string) => {
    if (editId || !me) {
      change({ title: value });
      setState((s) => (s ? { ...s, text: value } : s));
      return;
    }
    const parsed = parseLocally(value, nlpContext(me, allMembers, ctx.nowMs));
    setState((s) => {
      if (!s) return s;
      const applied = applyTextPatch(
        s.draft,
        protectTouched(nlpToPatch(parsed.draft, parsed.found, s.draft), s.touched, s.draft),
        s.textBefore,
      );
      const draft = applyDraftPatch(s.draft, applied.patch, { busyTouched: s.busyTouched });
      return {
        ...s,
        text: value,
        ...withReminders(s, draft),
        textBefore: applied.textBefore,
        parse: 'idle',
        source: null,
        ambiguities: [],
        error: null,
      };
    });
  };

  /**
   * 「確認へ」（Enter。変換確定の Enter は UI で除く）: オンラインなら POST /api/parse、だめならルール解析のまま。
   * 結果で下書きを置き換え（札で選んだ項目は残す）、曖昧さの質問と重なりの警告を出す（§16）
   */
  const submitText = async () => {
    const value = state.text.trim();
    if (!value || editId || !me) return;
    setState((s) => (s ? { ...s, parse: 'parsing' } : s));
    const local = parseLocally(value, nlpContext(me, allMembers, ctx.nowMs));
    let result: {
      source: 'ai' | 'rules';
      draft: typeof local.draft;
      ambiguities: typeof local.ambiguities;
      found: typeof local.found;
    } = {
      source: 'rules',
      ...local,
    };
    if (!offline && value.length <= 200) {
      try {
        const res = await Promise.race([
          apiRequest('POST', '/api/parse', { body: { text: value } }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), PARSE_TIMEOUT_MS)),
        ]);
        const parsed = res && res.status === 200 ? parseResponseSchema.safeParse(res.body) : null;
        if (parsed?.success) {
          result = {
            source: parsed.data.source,
            draft: parsed.data.draft as typeof local.draft,
            ambiguities: parsed.data.ambiguities,
            found: parsed.data.found,
          };
        }
      } catch {}
    }
    setState((s) => {
      if (!s) return s;
      // 待っているあいだに一言が変わった（書き直した・候補を選んだ）なら、この結果は使わない
      if (s.text.trim() !== value) return s.parse === 'parsing' ? { ...s, parse: 'idle' } : s;
      const applied = applyTextPatch(
        s.draft,
        protectTouched(nlpToPatch(result.draft, result.found, s.draft), s.touched, s.draft),
        s.textBefore,
      );
      const draft = applyDraftPatch(s.draft, applied.patch, { busyTouched: s.busyTouched });
      return {
        ...s,
        ...withReminders(s, draft),
        textBefore: applied.textBefore,
        parse: 'done',
        source: result.source,
        ambiguities: visibleAmbiguities(result.ambiguities, result.found).map((a) =>
          toAmbiguityVM(a, draft),
        ),
      };
    });
  };

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
      onChangeDraft={(patch) => change(patch, { touch: true })}
      onChooseAmbiguity={(ai, oi) => {
        const a = vm.ambiguities[ai];
        const option = a?.options[oi];
        if (!a || !option) return;
        if (ai < state.ambiguities.length) {
          // 一言の解析の曖昧さ（§16）: 選んだ答えに印を付けて当てる
          setState((s) =>
            s
              ? {
                  ...s,
                  ambiguities: s.ambiguities.map((x, i) => (i === ai ? { ...x, chosen: oi } : x)),
                }
              : s,
          );
          change(option.patch, { touch: true });
          return;
        }
        // 「月末にしますか？」（選んだ繰り返しは、一言を書き直しても上書きしない）
        setState((s) => (s ? { ...s, monthEnd: oi } : s));
        change(option.patch, { touch: true });
      }}
      onClose={nav.closeComposer}
      onPickSuggestion={(index) => {
        const s = vm.suggestions[index];
        if (s) change(s.patch);
      }}
      onSave={() => void save()}
      onSetMode={(mode) => setState((s) => (s ? { ...s, mode } : s))}
      onSubmitText={() => void submitText()}
      onTextChange={(value) => changeText(value)}
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

/** 書く画面の自分への通知の状態 */
function reminderStateOf(s: ComposerState): ReminderDraftState {
  return {
    touched: s.remindersTouched,
    pref: s.reminderPref,
    prefAllDay: s.reminderPrefAllDay,
    defaults: s.reminderDefaults,
  };
}

/** 親の繰り返しを書く画面の形に（回の中身には繰り返しがないため） */
function recurrenceDraft(master: LocalEvent): Pick<EventDraftVM, 'recurrence' | 'recurrenceEnd'> {
  const d = eventToDraft(master);
  return { recurrence: d.recurrence, recurrenceEnd: d.recurrenceEnd };
}
