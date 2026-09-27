import { readFileSync } from 'node:fs';
import { type EventDTO, memberSettingsSchema } from '@ito/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setTheme } from '../src/app/appearance';
import type { LocalEvent } from '../src/data/db';
import {
  MOCK_ME_ID,
  MOCK_TODAY,
  mockContext,
  mockEvents,
  mockMembers,
  mockMemberVMs,
} from '../src/ui/mock';
import type { EventDraftVM, MemberColor } from '../src/ui/types';
import { applyDraftPatch } from '../src/viewmodels/composer';
import {
  buildComposerVM,
  dateRange,
  quickDates,
  recentSuggestions,
  saveLabelFor,
} from '../src/viewmodels/composer-vm';
import { emptyDraft, findOccurrence } from '../src/viewmodels/detail';
import { buildFlowScreen, buildMonthScreen, buildSettingsVM } from '../src/viewmodels/screens';
import { ev, M, members } from './fixtures';

/** Phase 6 のレビューで直したもの（P6-*）の単体テスト */

const root = new URL('../../../', import.meta.url);

function flow(extra: Partial<Parameters<typeof buildFlowScreen>[0]> = {}) {
  const ctx = mockContext();
  return buildFlowScreen({
    events: mockEvents(),
    ctx,
    filter: null,
    from: '2030-09-28',
    to: '2030-11-20',
    selectedDate: MOCK_TODAY,
    weekStart: 0,
    unreadActivity: 0,
    notice: null,
    showBackToToday: false,
    ...extra,
  });
}

describe('これから（P6-contract-01・07、P6-behavior-06、P6-a11y-12）', () => {
  it('まとめの文に「新しい予定 n件」を入れない（ボタンで出す）', () => {
    const data = flow({ ctx: mockContext({ freshSince: 0 }) });
    expect(data.freshCount).toBeGreaterThan(0);
    expect(data.summary.join(' ')).not.toContain('新しい予定');
  });

  it('入力例は手元に予定が 1 件もないときだけ（絞り込みで 0 件でも出さない）', () => {
    expect(flow().emptyExamples).toEqual([]);
    expect(flow({ filter: ['nobody'] }).emptyExamples).toEqual([]);
    expect(flow({ events: [] }).emptyExamples.length).toBeGreaterThan(0);
  });

  it('見出しは今日の年・日付・曜日（移動した日の年ではない）', () => {
    expect(flow({ selectedDate: '2031-01-05' }).headerDateLabel).toBe('2030年 9月29日 日曜日');
  });

  it('無効にした家族だけが担当の予定は出さない（人の札が空にならない。表示用フィードと同じ）', () => {
    const disabled = mockMembers.map((m) => (m.name === 'さき' ? { ...m, disabled: true } : m));
    const data = flow({ ctx: mockContext({ members: disabled }) });
    const titles = data.items.flatMap((i) =>
      i.kind === 'day' ? [...i.day.allDay, ...i.day.timed].map((x) => x.occ.title) : [],
    );
    expect(titles).not.toContain('ピアノ');
    expect(titles).toContain('夕食');
  });
});

describe('書く画面（P6-SEC-01、P6-contract-03・12、P6-behavior-04）', () => {
  const draft = (extra: Partial<EventDraftVM>): EventDraftVM => ({
    ...emptyDraft('2030-09-30', MOCK_ME_ID, '22:00'),
    ...extra,
  });

  it('終わりが翌日（22:00〜0:00）のまま開始を動かしても長さを保つ', () => {
    const d = applyDraftPatch(
      draft({ endTime: '00:00' }),
      { startTime: '19:00' },
      { busyTouched: true },
    );
    expect([d.endTime, d.endDate]).toEqual(['21:00', '2030-09-30']);
  });

  it('自分の非公開の予定から来た候補は、非公開のまま入れる', () => {
    const events: LocalEvent[] = [
      ev({
        title: '心療内科',
        visibility: 'private',
        ownerId: MOCK_ME_ID,
        memberIds: [MOCK_ME_ID],
        startAt: '2030-09-20T10:00:00+09:00',
        createdAt: '2030-09-19T10:00:00+09:00',
      }),
    ];
    const [s] = recentSuggestions(events, mockContext().nowMs, mockMemberVMs);
    expect(s?.patch).toMatchObject({
      isPrivate: true,
      forEveryone: false,
      memberIds: [MOCK_ME_ID],
    });
    expect(s?.hint).toContain('非公開');
  });

  it('最近の予定: 回数順・同数なら新しい順、90 日より前と他人の非公開・例外行は数えない、最頻の人と時刻、全員・終日', () => {
    const nowMs = mockContext().nowMs;
    const at = (d: string, t = '19:30') => `${d}T${t}:00+09:00`;
    const e = (title: string | null, extra: Partial<EventDTO>) =>
      ev({ title, createdAt: at('2030-09-01'), ...extra });
    const list = recentSuggestions(
      [
        e('歯医者', { memberIds: [M.haru], startAt: at('2030-09-10') }),
        e('歯医者', { memberIds: [M.haru], startAt: at('2030-09-17') }),
        e('歯医者', { memberIds: [M.mama], startAt: at('2030-09-18', '10:00') }),
        e('夕食', { forEveryone: true, memberIds: [], startAt: at('2030-09-20', '18:00') }),
        e('旅行', {
          allDay: true,
          startDate: '2030-09-21',
          endDate: '2030-09-21',
          startAt: undefined,
          createdAt: at('2030-09-02'),
        }),
        e('古い', { startAt: at('2030-05-01'), createdAt: at('2030-05-01') }),
        e(null, { visibility: 'private', startAt: at('2030-09-20') }),
        e('例外', { parentId: 'p', recurrenceId: '2030-09-20T19:30', startAt: at('2030-09-20') }),
      ],
      nowMs,
      [
        { id: M.papa, name: 'お父さん', mark: '父', color: 'kaki', isMe: true },
        { id: M.mama, name: 'お母さん', mark: '母', color: 'wakatake', isMe: false },
        { id: M.haru, name: 'はる', mark: 'は', color: 'asagi', isMe: false },
      ],
    );
    expect(list.map((s) => s.title)).toEqual(['歯医者', '旅行', '夕食']);
    expect(list[0]).toMatchObject({
      hint: 'は · 19:30',
      patch: {
        title: '歯医者',
        memberIds: [M.haru],
        forEveryone: false,
        allDay: false,
        startTime: '19:30',
      },
    });
    expect(list[1]?.patch).toMatchObject({ allDay: true, startTime: null });
    expect(list[1]?.hint).toContain('終日');
    expect(list[2]?.patch).toMatchObject({ forEveryone: true, memberIds: [] });
    expect(list[2]?.hint).toBe('全員 · 18:00');
  });

  it('保存ボタンの文言（に保存・複数日の終日・日付なし）', () => {
    const base = draft({ title: '旅行' });
    expect(saveLabelFor({ ...base, allDay: false, startTime: '10:00' }, false)).toBe(
      '9/30(月) 10:00 に保存',
    );
    expect(
      saveLabelFor(
        { ...base, allDay: true, startTime: null, startDate: '2030-10-12', endDate: '2030-10-14' },
        false,
      ),
    ).toBe('10/12(土)〜10/14(月) 終日 に保存');
    expect(saveLabelFor({ ...base, startDate: '' }, false)).toBe('日付を選んでください');
  });

  it('日付の札: 金曜・土曜は重なる札を 1 つにする。選んだ日が札になければ足す', () => {
    expect(quickDates('2030-10-04').map((q) => q.label)).toEqual([
      '今日',
      '明日',
      '10/6(日)',
      '10/12(土)',
    ]);
    // 土曜: 次の日曜は明日と同じなので 1 つ（今日・明日・次の土曜・その次の土曜）
    expect(quickDates('2030-10-05').map((q) => q.label)).toEqual([
      '今日',
      '明日',
      '10/12(土)',
      '10/19(土)',
    ]);
    const ctx = mockContext();
    const vm = buildComposerVM({
      mode: 'quick',
      editing: false,
      text: '',
      draft: emptyDraft('2030-11-20', MOCK_ME_ID),
      today: ctx.today,
      nowMs: ctx.nowMs,
      events: [],
      members: mockMemberVMs,
      saving: false,
      error: null,
    });
    expect(vm.quickDates.at(-1)).toEqual({ label: '11/20(水)', date: '2030-11-20' });
    expect(dateRange('2030-09-29')).toEqual({ min: '2029-09-28', max: '2033-10-01' });
  });
});

describe('ほかの viewmodel（P6-tests-02）', () => {
  it('buildSettingsVM: 使用中の色は自分と無効の人を除く。家族の一覧は管理者だけ', () => {
    const me = {
      id: M.mama,
      name: 'お母さん',
      mark: '母',
      color: 'wakatake' as MemberColor,
      role: 'member' as const,
      aliases: [],
      settings: memberSettingsSchema.parse({}),
      activityReadAt: null,
    };
    const list = members.map((m) => (m.id === M.yuki ? { ...m, disabled: true } : m));
    const input = {
      me,
      members: list,
      adminMembers: [],
      textSize: 'standard' as const,
      permission: 'default' as const,
      devices: [],
      install: { platform: 'ios' as const, installed: false },
      appVersion: '1',
    };
    const vm = buildSettingsVM(input);
    expect(vm.takenColors.map((t) => t.mark)).toEqual(['父', 'は']);
    expect(vm.isAdmin).toBe(false);
    expect(vm.members).toEqual([]);
    const admin = buildSettingsVM({
      ...input,
      me: { ...me, role: 'admin' },
      adminMembers: [
        {
          id: M.mama,
          name: 'お母さん',
          mark: '母',
          color: 'wakatake',
          isMe: true,
          login: 'm',
          role: 'admin',
          disabled: false,
          deviceCount: 1,
        },
      ],
    });
    expect(admin.members).toHaveLength(1);
  });

  it('buildMonthScreen: 月曜始まりの並び、選んだ日の予定は絞り込みなし', () => {
    const data = buildMonthScreen({
      events: mockEvents(),
      ctx: mockContext(),
      year: 2030,
      month: 10,
      selectedDate: '2030-10-05',
      weekStart: 1,
    });
    expect(data.month.weekdayLabels[0]).toBe('月');
    expect(data.month.weeks[0]?.[0]?.weekday).toBe(1);
    expect(data.selectedDay.timed.map((t) => t.occ.title)).toEqual(['運動会']);
    expect(data.month.spans.length).toBeGreaterThan(0);
  });

  it('findOccurrence: recurrenceId なしは最初の回、ないものは null', () => {
    const e = mockEvents()[0] as LocalEvent;
    expect(findOccurrence(e, [], null)?.key).toBe(e.id);
    expect(findOccurrence(e, [], '2030-09-28T15:00')).toBeNull();
  });
});

describe('テーマ（P6-SEC-05・a11y-06・behavior-05・tests-05・a11y-10）', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubBrowser(dark: boolean) {
    const listeners = new Set<() => void>();
    const query = {
      matches: dark,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    const dataset: Record<string, string> = {};
    const metas = [
      {
        content: '',
        setAttribute(_: string, v: string) {
          this.content = v;
        },
      },
    ];
    vi.stubGlobal('matchMedia', () => query);
    vi.stubGlobal('document', { documentElement: { dataset }, querySelectorAll: () => metas });
    return {
      dataset,
      metas,
      flip(next: boolean) {
        query.matches = next;
        for (const fn of [...listeners]) fn();
      },
      listeners,
    };
  }

  it('「端末に合わせる」は端末の配色に追従し、ライト・ダークを選んだら追従をやめる', () => {
    const b = stubBrowser(false);
    setTheme('system');
    expect(b.dataset.theme).toBe('light');
    b.flip(true);
    expect(b.dataset.theme).toBe('dark');
    expect(b.metas[0]?.content).toBe('#0F1217');
    setTheme('light');
    expect(b.dataset.theme).toBe('light');
    expect(b.listeners.size).toBe(0);
    b.flip(false);
    b.flip(true);
    expect(b.dataset.theme).toBe('light');
    expect(b.metas[0]?.content).toBe('#F9F6F2');
  });
});

describe('家族の 8 色（P6-tests-04）', () => {
  it('8 色すべてに、札・点・糸・月の予定・線・名前の文字の規則がある', () => {
    const css = ['styles.css', 'member-colors.css']
      .map((f) => readFileSync(new URL(`apps/web/src/ui/${f}`, root), 'utf8'))
      .join('\n');
    const colors: MemberColor[] = [
      'yamabuki',
      'wakakusa',
      'wakatake',
      'asagi',
      'fuji',
      'momo',
      'ruri',
      'kaki',
    ];
    for (const c of colors) {
      for (const cls of [
        'member-tag',
        'dot',
        'thread',
        'node',
        'month-event',
        'month-span',
        'member-text',
      ]) {
        expect(css, `.${cls}--${c}`).toContain(`.${cls}--${c}`);
      }
    }
  });
});
