import { describe, expect, it } from 'vitest';
import { applyDraftPatch } from '../src/viewmodels/composer';
import { draftToInput, emptyDraft } from '../src/viewmodels/detail';
import { buildDay, groupByDay } from '../src/viewmodels/flow';
import { buildMonth } from '../src/viewmodels/month';
import { allDayEv, ctx, M } from './fixtures';

/** Phase 1 のレビューで見つかった viewmodels の不具合（WD-07〜10）の再現テスト */
describe('Phase 1 のレビューの指摘（viewmodels）', () => {
  it('WD-07: 時刻ありの予定の日付を前に動かしても長さは変わらない（終わりの日は開始日か翌日だけ）', () => {
    const d = { ...emptyDraft('2026-10-05', M.papa, '10:00'), title: 'x', endTime: '11:00' };
    const moved = applyDraftPatch(d, { startDate: '2026-10-03' }, { busyTouched: false });
    expect(draftToInput(moved)).toMatchObject({
      startAt: '2026-10-03T10:00:00+09:00',
      endAt: '2026-10-03T11:00:00+09:00',
    });
    // 古い終わりの日が残っていても、時刻ありは開始日か翌日にしかならない
    expect(draftToInput({ ...d, startDate: '2026-10-03', endDate: '2026-10-05' })).toMatchObject({
      endAt: '2026-10-03T11:00:00+09:00',
    });
  });

  it('WD-08: busy を触っていなければ、複数日の終日は busy になる（触ったらそのまま）', () => {
    const d = emptyDraft('2026-10-10', M.papa);
    expect(d.busy).toBe(false);
    const multi = applyDraftPatch(d, { endDate: '2026-10-12' }, { busyTouched: false });
    expect(multi.busy).toBe(true);
    expect(applyDraftPatch(d, { endDate: '2026-10-12' }, { busyTouched: true }).busy).toBe(false);
    // 開始日を動かすと複数日の長さを保つ
    expect(
      applyDraftPatch(multi, { startDate: '2026-10-11' }, { busyTouched: false }),
    ).toMatchObject({
      startDate: '2026-10-11',
      endDate: '2026-10-13',
    });
  });

  it('WD-09: 4 行で収まる月（2026 年 2 月・日曜始まり）も 5 行', () => {
    expect(buildMonth([], 2026, 2, 0, ctx()).weeks).toHaveLength(5);
  });

  it('WD-10: busy でない複数日の終日予定も、糸を太くする人に入る', () => {
    const events = [
      allDayEv('2026-09-28', '2026-09-30', { title: '合宿', memberIds: [M.haru], busy: false }),
    ];
    const byDay = groupByDay(events, '2026-09-29', '2026-09-30', ctx(), null);
    expect(buildDay('2026-09-29', byDay.get('2026-09-29'), ctx()).ongoingMemberIds).toEqual([
      M.haru,
    ]);
  });
});
