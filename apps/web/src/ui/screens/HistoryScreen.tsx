import { ArrowLeft } from 'lucide-react';
import { Button } from '../primitives/Controls';
import type { ActivityScreenProps, ActivityVM } from '../types';

const ACTION_LABEL: Record<ActivityVM['action'], string> = {
  create: 'を追加',
  update: 'を変更',
  delete: 'を削除',
  restore: 'を元に戻した',
};

/** S-08 履歴（開くと既読） */
export default function HistoryScreen({
  items,
  members,
  onBack,
  onOpenEvent,
  onLoadMore,
}: ActivityScreenProps) {
  const groups: { label: string; rows: ActivityVM[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.label === item.dayLabel) last.rows.push(item);
    else groups.push({ label: item.dayLabel, rows: [item] });
  }
  return (
    <>
      <header className="secondary-header">
        <Button aria-label="閉じる" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div>
          <p>家族の動き</p>
          <strong>履歴</strong>
        </div>
        <span />
      </header>
      <section className="secondary-scroll">
        {groups.length === 0 && (
          <div className="secondary-empty">
            <strong>まだ履歴はありません</strong>
            <p>家族が予定を追加・変更すると、ここに出ます。</p>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.label}>
            <div className="history-date">{group.label}</div>
            <div className="history-list">
              {group.rows.map((row) => {
                const actor = members.find((m) => m.id === row.actorId);
                return (
                  <Button
                    className="history-row"
                    key={row.id}
                    onClick={() => onOpenEvent(row.eventId)}
                  >
                    {row.unread && <i aria-label="未読" role="img" />}
                    <p>
                      <span className={actor ? `member-text--${actor.color}` : ''}>
                        {actor?.name ?? '家族'}
                      </span>
                      <span> が </span>
                      <strong>
                        {row.title} {ACTION_LABEL[row.action]}
                        {row.detail ? `（${row.detail}）` : ''}
                      </strong>
                    </p>
                    <time>{row.atLabel}</time>
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
        {items.length >= 50 && (
          <Button className="history-more" onClick={onLoadMore}>
            もっと見る
          </Button>
        )}
      </section>
    </>
  );
}
