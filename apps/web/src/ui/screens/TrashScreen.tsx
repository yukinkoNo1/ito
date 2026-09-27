import { ArrowLeft } from 'lucide-react';
import { Button } from '../primitives/Controls';
import type { TrashScreenProps } from '../types';

/** S-09 ゴミ箱（30 日保管。復元） */
export default function TrashScreen({ items, status, onBack, onRestore }: TrashScreenProps) {
  return (
    <>
      <header className="secondary-header">
        <Button aria-label="閉じる" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div>
          <p>30日後に自動で削除</p>
          <strong>ゴミ箱</strong>
        </div>
        <span />
      </header>
      <section className="secondary-scroll">
        {status !== 'ready' && items.length === 0 ? (
          <div className="secondary-empty" role="status">
            <strong>
              {status === 'loading' ? '読み込み中…' : 'ゴミ箱はオンラインで見られます'}
            </strong>
            {status === 'offline' && <p>家のサーバーにつながりません（Tailscale を確認）</p>}
          </div>
        ) : items.length ? (
          <div className="trash-list">
            {items.map((row) => (
              <div className="trash-row" key={row.eventId}>
                <div>
                  <strong>{row.title}</strong>
                  <time>{row.whenLabel}</time>
                  <p>
                    {row.deletedByName} が {row.deletedLabel} · <span>あと{row.daysLeft}日</span>
                  </p>
                </div>
                <Button onClick={() => onRestore(row.eventId)}>元に戻す</Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="secondary-empty">
            <strong>ゴミ箱は空です</strong>
            <p>削除した予定は30日間ここに残ります。</p>
          </div>
        )}
      </section>
    </>
  );
}
