import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../src/app/appearance';
import { mapUrl } from '../src/app/maps';
import { MOCK_TODAY, mockContext, mockEvents, mockMemberVMs } from '../src/ui/mock';
import { MOCK_EVENTS, MOCK_MEMBERS, toCreateBody } from '../src/ui/mock-data';
import { connectionText } from '../src/ui/primitives/AppShell';
import type { EventDraftVM } from '../src/ui/types';
import { applyDraftPatch } from '../src/viewmodels/composer';
import { buildComposerVM, quickDates } from '../src/viewmodels/composer-vm';
import { emptyDraft } from '../src/viewmodels/detail';
import { buildFlowScreen, toSyncVM } from '../src/viewmodels/screens';

const root = new URL('../../../', import.meta.url);
const spec = readFileSync(new URL('docs/SPEC.md', root), 'utf8');

/** SPEC の見出しのあとの最初のコードブロック */
function specBlock(after: string, lang: string): string {
  const at = spec.indexOf(after);
  expect(at, after).toBeGreaterThan(0);
  const start = spec.indexOf(`\`\`\`${lang}\n`, at) + lang.length + 4;
  const end = spec.indexOf('\n```', start);
  return spec.slice(start, end);
}

describe('§22 の契約（Phase 6）', () => {
  it('ui/tokens.css の色は §22 の値と同じ（書き方の違い＝大文字小文字・引用符・改行は見ない）', () => {
    const tokens = readFileSync(new URL('apps/web/src/ui/tokens.css', root), 'utf8');
    const vars = (css: string) => {
      const out: Record<string, Record<string, string>> = {};
      for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selector = (m[1] ?? '').replace(/[\s"]/g, '');
        out[selector] = Object.fromEntries(
          (m[2] ?? '')
            .split(';')
            .map((d) => d.trim())
            .filter(Boolean)
            .map((d) => {
              const i = d.indexOf(':');
              return [
                d.slice(0, i).trim(),
                d
                  .slice(i + 1)
                  .trim()
                  .toLowerCase(),
              ];
            }),
        );
      }
      return out;
    };
    const expected = vars(specBlock('**色（UI 担当 AI に渡した値）**', 'css'));
    expect(Object.keys(expected)).toEqual([':root', '[data-theme=dark]']);
    expect(Object.keys(expected[':root'] ?? {})).toHaveLength(29); // 基本 13 ＋ 家族の色 8 × 2
    expect(vars(tokens)).toEqual(expected);
  });

  it('ui/types.ts は §22 の型と同じ（変えたら SPEC も更新する）', () => {
    const types = readFileSync(new URL('apps/web/src/ui/types.ts', root), 'utf8');
    expect(types.trimEnd()).toBe(specBlock('**画面の props の型**', 'ts').trimEnd());
  });
});

describe('書く画面の下書き', () => {
  const timed = (start: string, end: string | null): EventDraftVM => ({
    ...emptyDraft('2030-09-30', 'me', start),
    endTime: end,
  });

  it('開始の時刻を動かすと、終わりの時刻も同じだけ動く（長さを保つ）', () => {
    const d = applyDraftPatch(
      timed('16:00', '16:30'),
      { startTime: '15:00' },
      { busyTouched: true },
    );
    expect([d.startTime, d.endTime, d.endDate]).toEqual(['15:00', '15:30', '2030-09-30']);
  });

  it('日付をまたぐ長さも保つ（23:00–翌1:00 を 22:00 にすると 翌0:00 まで）', () => {
    const d = applyDraftPatch(
      { ...timed('23:00', '01:00'), endDate: '2030-10-01' },
      { startTime: '22:00' },
      { busyTouched: true },
    );
    expect([d.endTime, d.endDate]).toEqual(['00:00', '2030-10-01']);
  });

  it('終わりの時刻がなければそのまま、終わりを一緒に変えたらそれを使う', () => {
    expect(
      applyDraftPatch(timed('16:00', null), { startTime: '09:00' }, { busyTouched: true }).endTime,
    ).toBeNull();
    const d = applyDraftPatch(
      timed('16:00', '16:30'),
      { startTime: '09:00', endTime: '12:00' },
      { busyTouched: true },
    );
    expect(d.endTime).toBe('12:00');
  });

  it('日付の札は日付で書く（「来週の土」と書かない。§16）', () => {
    expect(quickDates(MOCK_TODAY).map((q) => q.label)).toEqual([
      '今日',
      '明日',
      '10/5(土)',
      '10/6(日)',
      '10/12(土)',
    ]);
  });

  it('ComposerVM: 新しく書くときは開いた時点で最近の予定を出し、件名が空なら保存できない', () => {
    const ctx = mockContext();
    const draft = emptyDraft(MOCK_TODAY, ctx.meId);
    const vm = buildComposerVM({
      mode: 'quick',
      editing: false,
      text: '',
      draft,
      today: ctx.today,
      nowMs: ctx.nowMs,
      events: mockEvents(),
      members: mockMemberVMs,
      saving: false,
      error: null,
    });
    expect(vm.suggestions.length).toBeGreaterThan(0);
    expect(vm.suggestions.length).toBeLessThanOrEqual(5);
    expect(vm.saveLabel).toBe('件名を入れてください');
    const editing = buildComposerVM({
      mode: 'quick',
      editing: true,
      text: '歯医者',
      draft: { ...draft, title: '歯医者', allDay: false, startTime: '16:00' },
      today: ctx.today,
      nowMs: ctx.nowMs,
      events: mockEvents(),
      members: mockMemberVMs,
      saving: false,
      error: null,
    });
    expect(editing.suggestions).toEqual([]);
    expect(editing.saveLabel).toBe('9/29(日) 16:00 に変更');
  });
});

describe('同期の状態（C-02）', () => {
  it('426 は「アプリを更新してください」と「更新」、403 はログインを出す', () => {
    const outdated = toSyncVM('error', null, 1, { kind: 'client_outdated' });
    expect(outdated).toMatchObject({ errorLabel: 'アプリを更新してください', action: 'update' });
    expect(connectionText(outdated)).toBe('アプリを更新してください · 未送信 1件');
    const notMember = toSyncVM('error', null, 0, { kind: 'not_member', login: 'x@example.com' });
    expect(notMember.errorLabel).toContain('x@example.com');
    expect(notMember.action).toBe('retry');
  });

  it('つながらないときは既定の文と「再試行」', () => {
    const offline = toSyncVM('offline', null, 2);
    expect(offline).toMatchObject({ errorLabel: null, action: 'retry' });
    expect(connectionText(offline)).toBe(
      '家のサーバーにつながりません（Tailscale を確認） · 未送信 2件',
    );
  });
});

describe('これから（S-01）', () => {
  it('移動した日は予定がなくても日の見出しを出し、そこに合わせる', () => {
    const ctx = mockContext();
    const data = buildFlowScreen({
      events: mockEvents(),
      ctx,
      filter: null,
      from: '2030-09-28',
      to: '2030-11-20',
      selectedDate: '2030-10-20',
      weekStart: 0,
      unreadActivity: 0,
      notice: null,
      showBackToToday: true,
    });
    expect(data.anchorKey).toBe('day:2030-10-20');
    expect(data.items.some((i) => i.key === 'day:2030-10-20')).toBe(true);
  });
});

describe('ギャラリーの見本', () => {
  it('見本の予定は自分（お父さん）から見た投影（さきの非公開は「予定あり」）', () => {
    const events = mockEvents();
    expect(events).toHaveLength(MOCK_EVENTS.length);
    const secret = events.find((e) => e.visibility === 'private');
    expect(secret).toMatchObject({ title: null, location: null, note: null });
  });

  it('E2E に入れる本文は人の key を ID にする', () => {
    const ids = new Map(MOCK_MEMBERS.map((m) => [m.key, `id-${m.key}`]));
    const dinner = MOCK_EVENTS.find((e) => e.key === 'dinner');
    const dentist = MOCK_EVENTS.find((e) => e.key === 'dentist');
    if (!dinner || !dentist) throw new Error('見本がない');
    expect(toCreateBody(dinner, (k) => ids.get(k) ?? '')).toMatchObject({
      forEveryone: true,
      memberIds: [],
    });
    expect(toCreateBody(dentist, (k) => ids.get(k) ?? '')).toMatchObject({
      memberIds: ['id-haruto'],
      location: '駅前歯科',
    });
  });
});

describe('見た目と外部リンク', () => {
  it('テーマ: 端末に合わせるなら prefers-color-scheme、選んでいればそちら', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('地図のリンクは encodeURIComponent で組み立てる（§18 T4）', () => {
    expect(mapUrl('駅前歯科 & 2F', 'ios')).toBe(
      `https://maps.apple.com/?q=${encodeURIComponent('駅前歯科 & 2F')}`,
    );
    expect(mapUrl('a#b', 'android')).toBe('https://www.google.com/maps/search/?api=1&query=a%23b');
  });
});
