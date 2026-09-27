import { ArrowLeft, Search, X } from 'lucide-react';
import { Button, Input } from '../primitives/Controls';
import ScheduleEventRow from '../primitives/ScheduleEventRow';
import type { SearchScreenProps } from '../types';

/** S-10 検索（タイトル・場所・メモの部分一致。人で絞り込み、最近の検索語） */
export default function SearchScreen({
  query,
  groups,
  members,
  filterMemberIds,
  recentQueries,
  onQueryChange,
  onSetFilter,
  onBack,
  onOpenOccurrence,
}: SearchScreenProps) {
  const selected = filterMemberIds ?? [];
  const togglePerson = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onSetFilter(next.length ? next : null);
  };
  const count = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <header className="search-header">
        <Button aria-label="閉じる" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div>
          <Search aria-hidden="true" />
          <Input
            aria-label="予定を検索"
            autoFocus
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="予定名、場所、メモ"
            type="search"
            value={query}
          />
          {query && (
            <Button aria-label="検索語を消す" onClick={() => onQueryChange('')}>
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>
      {/* biome-ignore lint/a11y/useSemanticElements: fieldset の既定の枠と flex の差を避けて見た目を変えない（role=group で同じ意味） */}
      <div className="search-people" aria-label="人で絞り込み" role="group">
        {members.map((member) => (
          <Button
            aria-pressed={selected.includes(member.id)}
            className={`search-person search-person--${member.color}`}
            key={member.id}
            onClick={() => togglePerson(member.id)}
          >
            {member.mark}
          </Button>
        ))}
      </div>
      <section className="secondary-scroll search-content">
        {!query.trim() ? (
          <div className="recent-searches">
            <p>最近の検索</p>
            {recentQueries.map((term) => (
              <Button key={term} onClick={() => onQueryChange(term)}>
                {term}
              </Button>
            ))}
          </div>
        ) : count ? (
          <div className="search-results">
            <p className="search-count">{count}件見つかりました</p>
            {groups.map((group) => (
              <div className="search-date-group" key={group.dateLabel}>
                <div className="search-date-heading">{group.dateLabel}</div>
                {group.items.map((occ) => (
                  <ScheduleEventRow
                    key={occ.key}
                    members={members}
                    occ={occ}
                    onOpen={() => onOpenOccurrence(occ.key)}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="secondary-empty">
            <strong>「{query}」は見つかりませんでした</strong>
            <p>人の絞り込みを外すか、短い言葉で試してください。</p>
          </div>
        )}
      </section>
    </>
  );
}
