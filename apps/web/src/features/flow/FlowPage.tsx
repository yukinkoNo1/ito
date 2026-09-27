import { addDays } from '@ito/core';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useEvents, useMe, useMeta, useVmContext } from '../../app/data-context';
import { buildDay, buildFlowItems, buildSummary, groupByDay } from '../../viewmodels/flow';
import { toMemberVMs } from '../../viewmodels/occurrence';
import { DayBlock } from '../common/DayList';

/** S-01 これから（素朴な HTML。Phase 6 で本番の UI に差し替える） */
export function FlowPage() {
  const ctx = useVmContext();
  const events = useEvents();
  const me = useMe();
  const unread = useMeta<number>('unreadActivity') ?? 0;
  const [filter, setFilter] = useState<string[] | null>(null);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const view = useMemo(() => {
    if (!ctx || !events) return null;
    const from = addDays(ctx.today, -1);
    const to = addDays(ctx.today, 60);
    const items = buildFlowItems(events, from, to, ctx, filter);
    const today = buildDay(
      ctx.today,
      groupByDay(events, ctx.today, addDays(ctx.today, 1), ctx, null).get(ctx.today),
      ctx,
    );
    return { items, summary: buildSummary(today, ctx.members, 0) };
  }, [ctx, events, filter]);

  if (!ctx || !view || !me) return <p>読み込み中…</p>;
  const members = toMemberVMs(ctx.members, ctx.meId);
  const openKey = (key: string) => {
    const [eventId, rid] = key.split('@');
    navigate(`/e/${eventId}${rid ? `?r=${encodeURIComponent(rid)}` : ''}`);
  };
  const compose = (date: string) => {
    const next = new URLSearchParams(params);
    next.set('compose', '1');
    next.set('date', date);
    setParams(next);
  };

  return (
    <div>
      <header className="mb-2">
        <h1 className="text-xl">これから</h1>
        <p>
          <span className="sr-only">今日のまとめ: </span>
          {view.summary.join(' · ')}
        </p>
        <p>
          <a
            href="/activity"
            onClick={(e) => {
              e.preventDefault();
              navigate('/activity');
            }}
          >
            履歴{unread > 0 ? `（未読 ${unread}）` : ''}
          </a>
        </p>
      </header>
      <fieldset className="mb-2 flex flex-wrap gap-2">
        <legend className="sr-only">家族で絞り込み</legend>
        <button
          type="button"
          className="min-h-11 px-3"
          aria-pressed={filter === null}
          onClick={() => setFilter(null)}
        >
          全員
        </button>
        <button
          type="button"
          className="min-h-11 px-3"
          aria-pressed={filter?.[0] === me.id}
          onClick={() => setFilter([me.id])}
        >
          自分
        </button>
        {members
          .filter((m) => !m.isMe)
          .map((m) => (
            <button
              key={m.id}
              type="button"
              className="min-h-11 px-3"
              aria-pressed={filter?.[0] === m.id}
              onClick={() => setFilter([m.id])}
            >
              {m.name}
            </button>
          ))}
      </fieldset>
      {view.items.map((item) => {
        if (item.kind === 'month')
          return (
            <h2 key={item.key} className="mt-3 font-bold">
              {item.label}
            </h2>
          );
        if (item.kind === 'gap')
          return (
            <p key={item.key} className="py-1 text-sm">
              {item.label}
            </p>
          );
        return (
          <DayBlock
            key={item.key}
            day={item.day}
            members={members}
            onOpen={openKey}
            onCompose={compose}
          />
        );
      })}
    </div>
  );
}
